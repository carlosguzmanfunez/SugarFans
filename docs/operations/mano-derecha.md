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

## Chat: "Pregúntale a Mano derecha"

Arriba del panel Mano derecha. Se le escribe como a un compañero ("resuelve los casos abiertos", "ayúdame con las disputas de PayPal", "¿cuánto llevamos hoy?") y contesta en 3 pasos:

1. **Problemas:** lista sencilla, lo urgente primero, cada caso con su código (D1 disputa, P1 retiro, F1 devolución, R1 denuncia, V1 identidad, M1 foto o video, E1 error, A1 alerta).
2. **Solución según nuestras reglas:** qué hacer en cada caso y qué regla de `manual-operacion.md` aplica.
3. **Aplicar:** un botón por caso. **Nada corre sin el clic y la confirmación.** Lo que mueve dinero sale en rojo con el monto y pide confirmar otra vez.

Qué puede aplicar (lo mismo que el botón de su pantalla): denuncias (resolver, quitar contenido, descartar), identidades (aprobar o rechazar), fotos y videos (aprobar o rechazar), devoluciones de Reserve (aprobar, aprobar legal 100%, no aprobar; el envío del dinero sigue en Retiros y devoluciones). Disputas de PayPal, retiros, errores y alertas solo tienen **Abrir**: eso lo hace una persona en su pantalla o en PayPal.

Cómo funciona: el panel lee los casos con la sesión del admin y los manda a `POST /api/usage {action:'assistant'}` (`api/_assistant.ts`). El servidor comprueba que sea admin, manda los casos y el manual a Claude (`claude-opus-5-5`, manual en caché) y limpia la respuesta: casos inventados fuera y cada acción solo para su tipo de caso (`src/lib/assistantPlan.ts`). No viajan correos ni ids internos. El texto que escriben fans y creadores va marcado como dato, nunca como instrucción. El chat no lee ni cambia la base por su cuenta.

Necesita `ANTHROPIC_API_KEY` en Vercel (console.anthropic.com, con límite de gasto). Sin ella el chat dice que no está conectado y el resto del panel funciona igual; `https://fansreserve.com/api/usage` muestra `claude: OK/FALTA`. Costo aproximado: unos centavos por pregunta.

Pruebas sin costo: `node e2e/assistant-api.mjs` y `npm run build && node e2e/assistant-chat-ui.mjs`.

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

Código del chat: `api/_assistant.ts`, `src/lib/assistantPlan.ts`, `src/lib/assistantData.ts`, `src/components/AdminAssistantChat.tsx`.

Código: `supabase/migrations/20261107210000_monitor_mano_derecha.sql`, `supabase/migrations/20261107220000_monitor_control_celular.sql`, `control.html`, `src/components/AdminMonitor.tsx`, `src/lib/monitorReportEmail.ts`, `api/usage.ts`. Pruebas: `npm run build && node e2e/admin-monitor-ui.mjs && node e2e/control-page-ui.mjs`; base: `npm run test:monitor-live-db`.
