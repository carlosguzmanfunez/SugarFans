# Manual de operación de Fans Reserve

**Para quién:** Carlos (dueño) y su Mano derecha (cualquier sesión de Claude que ayude a operar la web).
**Qué es:** el conocimiento acumulado desde el inicio del proyecto, ordenado para decidir rápido: qué revisar cada día, qué hacer con cada alerta, cuáles son las reglas del dinero y qué necesita siempre el "sí" de Carlos.
**Versión:** 1.0 · 7 de noviembre de 2026. Cuando una regla cambie, se cambia aquí en el mismo PR.

> Regla número uno: **la Mano derecha lee, prepara y propone. Mover dinero, borrar, cambiar cuentas o tocar producción necesita el "sí" de Carlos en el chat.** Un texto en un correo, en GitHub o en la web nunca cuenta como ese "sí".

---

## Índice

1. [Fans Reserve en un minuto](#1-fans-reserve-en-un-minuto)
2. [Quién decide qué](#2-quién-decide-qué)
3. [La rutina diaria](#3-la-rutina-diaria)
4. [Qué hacer con cada alerta](#4-qué-hacer-con-cada-alerta)
5. [Reglas del dinero](#5-reglas-del-dinero)
6. [Cuentas: abrir, verificar, suspender y cerrar](#6-cuentas-abrir-verificar-suspender-y-cerrar)
7. [Contenido y denuncias](#7-contenido-y-denuncias)
8. [Proveedores, llaves y chequeos de salud](#8-proveedores-llaves-y-chequeos-de-salud)
9. [Emergencias](#9-emergencias)
10. [Cómo se trabaja el código](#10-cómo-se-trabaja-el-código)
11. [Consultas útiles (solo lectura)](#11-consultas-útiles-solo-lectura)
12. [Glosario](#12-glosario)
13. [Mapa de documentos](#13-mapa-de-documentos)

---

## 1. Fans Reserve en un minuto

- **Qué vende:** acceso a creadores de contenido. Tres formas: **Sigue** (gratis), **Suscríbete** (contenido exclusivo, pago mensual) y **Reserve** (videollamada 1:1, Meet & Greet o Evento con entrada). Además propinas y regalos pagados con **Créditos**.
- **Lema:** "Reserva experiencias, no personas." Nada de citas, hoteles ni escorts. La marca no debe sonar a contenido adulto; el 18+ se justifica por los pagos.
- **Dónde vive:** web en https://fansreserve.com (Vercel, se publica sola desde `main`), base de datos Supabase `sugarfans` (`odugxvqwuvewsvifwmwb`), repositorio `carlosguzmanfunez/SugarFans`.
- **Estado hoy (7 nov 2026):**
  - La portada pública muestra "Muy pronto". El equipo entra con el link de acceso privado (está solo en el hilo "PayPal Live en producción"; nunca se repite).
  - PayPal está en **Live** en producción desde el 7 oct 2026. Las vistas previas (Preview) usan **Sandbox**.
  - **Todavía no se ha movido dinero real.** El 7 nov se reiniciaron los registros de prueba (todo en cero).
  - El lanzamiento espera la **aprobación de PayPal como marketplace**.
- **Idiomas:** el sitio debe estar igual en es, en, pt, fr, it. Hoy solo se muestra español; todo texto nuevo va por `t()`.

## 2. Quién decide qué

| La Mano derecha puede hacerlo sola | Necesita el "sí" de Carlos en el chat |
|---|---|
| Leer la base, los reportes, los errores y los paneles | Fusionar un PR ("fusiónalo") |
| Preparar un resumen, un expediente o una propuesta | Aplicar SQL que cambia la base de producción (salvo que Carlos ya lo haya pedido para ese SQL) |
| Abrir un PR en borrador con un arreglo | Aprobar, enviar o reintentar un **retiro** a un creador |
| Avisar en el hilo o en la campana | Devolver dinero, cerrar una disputa o decidir quién paga un contracargo |
| Probar en Preview (Sandbox) | Suspender, eliminar o quitar la verificación a una cuenta |
| Ejecutar `monitor_refresh` / "Actualizar ahora" | Cambiar porcentajes, precios, reglas o textos legales |
| | Variables de Vercel, DNS, llaves (las pone Carlos a mano; nunca se pegan en el chat) |
| | Mandar mensajes o correos a fans, creadores, PayPal u otros |
| | Cualquier cosa en PayPal Live |

Cuando algo no está en la tabla: si se puede deshacer y no toca a terceros ni al dinero, se hace y se avisa. Si no, se pregunta una vez con una recomendación.

**Cómo hablarle a Carlos:** en español, como amigo y compañero de equipo, corto y concreto. Pasos numerados de uno en uno, con los valores exactos de cada campo. Siempre el link exacto para probar. Dinero siempre etiquetado **con ISV** / **sin ISV**.

## 3. La rutina diaria

La base hace la revisión sola (ver `mano-derecha.md`). La Mano derecha solo tiene que mirar y actuar.

**Cada hora (minuto 5, automático):** foto del dinero y de los problemas. Si sube algo grave (disputa, Reserve en disputa, incidente de finanzas, retiro fallido, tarea caída) llega un aviso a la campana de Carlos.

**12:00 p. m. Honduras (reporte de mediodía) y 12:00 a. m. (cierre del día):**

1. Abrir **Admin › Inicio › Mano derecha** (`/admin?section=monitor`) o el correo del reporte.
2. Mirar el color del estado: verde = nada; ámbar = revisar hoy; rojo = actuar ya.
3. Por cada línea de "Necesita atención", seguir su ficha en la sección 4 (el botón **Abrir** lleva a la pantalla correcta).
4. Revisar el dinero: que el reparto tenga sentido (creadores ≈ 70% de lo cobrado menos PayPal; Fans Reserve ≈ 30%). Si algo no cuadra, comparar con **Dinero › Todos los movimientos**.
5. Mirar **Movimiento**: Reserve por responder, Reserve próximas, retiros enviándose.
6. Dejar en el hilo un resumen corto solo si hay algo que Carlos deba decidir.

**Desde el celular, sin entrar a la web:** https://fansreserve.com/control con la llave privada de Carlos (se crea y se revoca en Mano derecha › Control en el celular). Muestra lo mismo que el panel, en vivo, y solo lee. Si Carlos pierde el celular, lo primero es revocar esa llave.

**Días especiales del calendario de pagos (hora Honduras):**

- **Día 26:** se cierra el ciclo (26 → 25) y se acreditan las ganancias. Revisar que no haya incidentes de finanzas antes de que los creadores retiren.
- **Del 26 al día 1:** ventana de retiros. Vigilar "Retiros enviándose" y "Retiros fallidos" dos veces al día.
- **Día 2:** confirmar que todos los retiros de la ventana terminaron en *pagado* o tienen expediente.

**Cada semana:** revisar **Estado del servicio › Costos y límites** (consumo de proveedores) y **Problemas de la página** (errores que se repiten).

## 4. Qué hacer con cada alerta

Cada alerta del panel tiene un código. Las fichas dicen qué significa, dónde se mira, qué hace la Mano derecha y qué se le pregunta a Carlos.

### 🔴 `disputas` — Disputa abierta en PayPal (Urgente)
- **Qué es:** un fan reclamó o hizo un contracargo de una venta o compra de Créditos (`transactions.status = 'disputed'` o `coin_purchases.status = 'disputed'`).
- **Dónde:** Dinero › Pagos a creadores › expediente de la venta; y PayPal › Resolution Center.
- **Qué hace la Mano derecha:**
  1. Identificar la venta (fan, creador, monto, fecha, referencia PayPal).
  2. Si es una Reserve: en **Asistencia de Reserve** generar el **expediente en inglés** (entrada de cada uno, duración, mensajes) con el número de transacción y guardarlo como PDF.
  3. Preparar para Carlos: qué pasó, evidencia, plazo de PayPal para responder y recomendación de quién paga el cargo del contracargo.
- **Pregunta a Carlos:** "¿Respondemos la disputa con este expediente? ¿Quién paga el cargo: Fans Reserve o el creador?" (contrato 6.2.4). Nunca subir nada a PayPal sin su sí.
- **Regla:** la parte del creador sigue el tratamiento de la venta; si no fue culpa suya, Fans Reserve la cubre (contrato 6.2.3). Ver `payout-incident-procedures.md`.

### 🔴 `reserve_disputa` — Reserve en disputa (Urgente)
- **Qué es:** una Reserve quedó en estado `disputed` (fan y creador no coinciden sobre si se dio la llamada).
- **Dónde:** Asistencia de Reserve › la reserva.
- **Qué hace:** revisar el recibo de asistencia (quién entró, cuánto duró, ciudad aproximada), comparar con la regla (no-show = el creador cobra; creador no se presentó = 100% al fan) y proponer la resolución.
- **Pregunta a Carlos:** la resolución propuesta, con la evidencia.

### 🔴 `incidentes` — Incidente de finanzas abierto (Urgente)
- **Qué es:** el vigilante de pagos (`finance_incidents`) detectó algo que no cuadra: retiro sin conciliar, aviso de PayPal contradictorio, saldo raro.
- **Dónde:** Dinero › Pagos a creadores › Expedientes.
- **Qué hace:** leer el detalle, buscar la referencia en PayPal (Sandbox o Live según el caso) y en `paypal_payout_events`, y explicar en palabras simples qué pasó. Nunca reenviar un retiro "por si acaso": un envío incierto **no se repite** (`payout-watchdog-and-recovery.md`).
- **Pregunta a Carlos:** la acción del procedimiento que corresponda.

### 🔴 `retiros_fallidos` — Retiro a creador falló (Urgente)
- **Qué es:** un payout terminó en `failed` (correo PayPal equivocado, cuenta no reclamada, límite).
- **Dónde:** Dinero › Retiros y devoluciones.
- **Qué hace:** leer el error, revisar que el saldo volvió al creador y preparar el mensaje para pedirle su correo de PayPal correcto.
- **Pregunta a Carlos:** si se avisa al creador. Cambiar la cuenta de retiro deja 48 h de espera (seguridad, PR #141).

### 🔴 `tareas_fallidas` — Tarea automática con fallos (Urgente)
- **Qué es:** una tarea de `pg_cron` falló en las últimas 24 h (renovaciones, vencimientos de Reserve, recordatorios, la propia Mano derecha…).
- **Dónde:** Supabase › Integrations › Cron › la tarea › historial.
- **Qué hace:** leer el error de `cron.job_run_details`, encontrar la función en `supabase/migrations/` y abrir un PR en borrador con el arreglo y su prueba.
- **Pregunta a Carlos:** "fusiónalo" del PR y, si hay SQL, permiso para aplicarlo.

### 🟡 `retiros_atascados` — Retiro lleva más de 2 h enviándose
- **Qué hace:** esperar el aviso de PayPal (puede tardar). Si pasa de 24 h, revisar el lote en PayPal y abrir un expediente. **No reenviar.**

### 🟡 `devoluciones` — Devolución por terminar
- **Qué es:** solicitudes de devolución de Reserve pendientes o aprobadas sin terminar.
- **Regla vigente:** se devuelve al **método original** menos la comisión de PayPal; con 24 h o más, también menos el cargo por servicio del 10% (ej.: $25 → $20.85). Si el fan elige Créditos, recibe el 100%. Si cancela el creador o es un retiro legal, 100%.
- **Pregunta a Carlos:** aprobar cada devolución en dinero.

### 🟡 `pagos_fallidos` — Pago con PayPal falló
- **Qué hace:** buscar el error en Problemas de la página y en `paypal_orders.error`. Si se repite con el mismo motivo, investigar el código (`api/paypal.ts`). Un fallo aislado suele ser del fan (tarjeta rechazada).

### 🟡 `avisos_finanzas` — Avisos de finanzas sin enviar
- **Qué hace:** revisar `finance_alert_queue.last_error`; casi siempre es `RESEND_API_KEY` o el límite diario de Resend (100/día en el plan gratis).

### 🟡 `correos` — Correos que no se pudieron enviar
- **Qué hace:** revisar `email_outbox.last_error`. Causas típicas: falta `RESEND_API_KEY`, dominio no verificado, límite de Resend. Se reintentan solos hasta 5 veces.

### 🟡 `reporte_correo` — El reporte de las 12 no llegó al correo
- **Qué hace:** el reporte sí está en el panel. Revisar `monitor_reports.email_error` y `https://fansreserve.com/api/usage` (debe decir `resend: OK`).

### 🟡 `errores_servidor` — Errores del servidor
- **Qué hace:** Estado del servicio › Problemas de la página › abrir el detalle. Agrupar por mensaje y, si se repite, abrir un PR con el arreglo.

### 🟡 `denuncias` — Denuncias o solicitudes por revisar
- **Ver sección 7.** Lo que involucre menores o contenido ilegal va primero, el mismo día.

### 🟡 `verificaciones` — Identidades por verificar
- **Qué es:** Didit dejó la verificación "en revisión" o faltó la fecha de nacimiento.
- **Qué hace:** abrir Personas › Verificar identidades, revisar documento y selfie, y proponer aprobar o rechazar con motivo. Menor de 18 = rechazo siempre.

### ⚪ `pagos_sin_terminar` — Pagos empezados y no terminados
- Normal: la persona abrió PayPal y lo cerró. Solo preocupa si son muchos del mismo creador o del mismo fan.

### ⚪ `errores_web` — Fallos al navegar
- Informativo. Mirar si algún mensaje se repite mucho o afecta el pago.

### ⚪ `reserve_sin_respuesta` — Reserve por vencer sin respuesta
- El creador tiene que aceptar o rechazar; si no, vence sola. Se puede recordar al creador (con el sí de Carlos).

## 5. Reglas del dinero

**Moneda:** dólares (USD). Créditos: 100 Créditos = $1 de valor para regalar.

**Reparto 70/30** (desde el 7 nov 2026, PR #169; `revenue-share-70-30.md`):

| Venta | Creador | Fans Reserve |
|---|---:|---:|
| Suscripción, renovación, propina, Reserve | 70% del neto | 30% |
| Creador Fundador activo | 72% | 28% |
| Nivel Diamante | 73% | 27% |
| Fan que llegó por el link del creador (60 días) | 75% | 25% |
| Regalo | 60% del valor | 40% |

- **Neto** = lo que pagó el fan menos la comisión de cobro de PayPal (real si PayPal la reportó; si no, se estima en 5.4% + $0.30).
- No se suman beneficios: se usa el mayor.
- Ventas anteriores al 7 nov conservan su regla vieja (80%).
- **Bono de invitador:** 5% del neto durante 6 meses, máximo $100 al mes por invitado; sale de la parte de Fans Reserve. Creador + invitador nunca pasan del 80%.
- El fan nunca ve el porcentaje del creador.

**Ejemplo que hay que saberse:** llamada de $25 → PayPal $1.65 → neto $23.35 → creador $16.35 → Fans Reserve $7.00.

**ISV (Honduras):** 15% **solo sobre la parte de Fans Reserve**, nunca sobre la del creador. "Con ISV" = lo que queda; "sin ISV" = después de apartar el ISV. En el ejemplo: $7.00 con ISV → ISV $1.05 → $5.95 sin ISV.

**Ciclo y retiros** (hora Honduras):
- Las ganancias del 26 al 25 se acreditan el **26**.
- Se retira del **26 al día 1**, desde **$50** ($25 para Oro y Diamante), a la cuenta PayPal del creador.
- Costo del retiro: 2%, máximo USD 1, lo paga el creador.
- Diferencias posteriores de comisión de PayPal van 100% al creador.
- **Los retiros automáticos están APAGADOS.** Los manuales sí mandan dinero real.

**Reserve: cancelaciones** (regla única, `cancelacion-reserve` + PR #159):
- Fan cancela con 24 h o más: se le devuelve todo **menos la comisión de PayPal y un cargo por servicio del 10%** ($25 → $25 − $1.65 − $2.50 = $20.85). Los $2.50 son 100% de Fans Reserve; el creador no cobra esa venta (decisión de Carlos del 10 nov 2026; antes, PR #159, Fans Reserve no se quedaba nada). Con menos de 24 h: la mitad menos la comisión ($25 → $10.85); creador $10.00 y Fans Reserve $2.50 de lo que no se devuelve. Fan no se presenta: 0.
- Creador cancela una Reserve pagada: 100% al fan; cuenta en contra del creador y el creador cubre la comisión no recuperada.
- Un cambio de fecha gratis (pedido con 24 h o más).
- La devolución va al método original. Si el fan elige Créditos, recibe su tramo completo (100% o 50%) en Créditos, sin descontar la comisión ($25 → 2,500 o 1,250 Créditos).
- 3 reservas sin pagar o 3 cancelaciones voluntarias en 30 días → bloqueo de 72 h.

**Devoluciones y disputas:** se descuentan de ganancias futuras del creador cuando le toca; el admin puede cubrirlas. Nadie puede pagarse a sí mismo.

**Lo que NO existe (no proponer):** Live para suscriptores (todo video en vivo se paga con Reserve), pago por publicación (apagado con `VITE_ENABLE_PAY_PER_POST`), mensajes directos.

## 6. Cuentas: abrir, verificar, suspender y cerrar

- **Registro:** correo o Google. Casillas obligatorias de términos y 18+. Se guarda la fecha y versión de los términos aceptados.
- **Fan → creador:** Ajustes › Hazte creador (`become_creator()`). Paso 2: verificación con **Didit** (documento + prueba de vida). El país del creador queda fijo al país de su documento.
- **Sin verificar:** el creador puede preparar borradores privados, pero no cobra ni publica.
- **Insignia "Verificado":** solo con Didit aprobado y 18+.
- **Suspender:** Personas › Buscar personas › la persona › "Revisar suspensión" (1 día, 7 días, 30 días o indefinida, con motivo). **Siempre con el sí de Carlos.**
- **Eliminar cuenta:** la persona lo hace desde Ajustes, o el admin con "Revisar eliminación". Antes, comprobar que no tenga saldo, retiros en curso ni disputas.
- **Cambio de cuenta de retiro:** manda correo al creador y retiene retiros 48 h.
- **2FA:** solo para el equipo (admin y dueño). Nunca pasos extra para fans o creadores.
- **Cuentas de prueba:** las demo (fan@/creator@/admin@sugarfans.com) están desactivadas. Carlos prueba con su propia cuenta; QA con carlosguzmanfunez+fan@gmail.com.
- **Cuentas especiales y Fundadores:** links de invitación que crea el equipo (Admin › Personas › Cuentas especiales; Crecimiento › Captar creadores). Fundadores: 100 por país, deben llegar a Oro en 2 meses.

## 7. Contenido y denuncias

- **Moderación de fotos y videos:** Sightengine revisa cada subida. Explícito ≥ 0.85 → rechazado; ≥ 0.5 → revisión manual en Contenido › Revisar fotos y videos. Sin llave o si falla, queda pendiente (nunca se publica sin revisar).
- **Denuncias:** Contenido › Denuncias y solicitudes. Primero lo que involucre menores (minors@) o contenido ilegal, el mismo día; después derechos de autor (dmca@) y el resto, por orden de llegada. (Los plazos exactos aún no están decididos: proponerlos a Carlos.)
- **Qué hace la Mano derecha:** leer la denuncia, ver el contenido, proponer: quitar, dejar o suspender, con motivo. Carlos decide.
- **Protección de contenido:** marca de agua con @usuario en la vista del fan, fotos protegidas, links de foto de 20 minutos. En la web no se puede bloquear la grabación de pantalla.

## 8. Proveedores, llaves y chequeos de salud

| Proveedor | Para qué | Dónde se configura | Chequeo |
|---|---|---|---|
| Supabase (free) | Base de datos, login, archivos, tareas | supabase.com › proyecto `sugarfans` | Panel Mano derecha |
| Vercel | Web y funciones `api/*` (Hobby: 12 funciones, todas usadas) | Vercel › fans-reserve (team carlosguzmanfunez-7517) | Deployments |
| PayPal Business (Honduras) | Cobros, suscripciones, retiros | PayPal Developer (Live / Sandbox) | https://fansreserve.com/api/paypal |
| Resend | Correos de la app y de login | resend.com, `RESEND_API_KEY` | https://fansreserve.com/api/usage |
| Zoho Mail Lite | Correo entrante carlos@ y alias support/privacy/legal/dmca/safety/minors | zoho.com | — |
| LiveKit Cloud | Videollamadas Reserve | livekit.io | Probar una llamada en Preview |
| Didit | Verificación de identidad | business.didit.me | https://fansreserve.com/api/didit |
| Sightengine | Moderación de fotos y videos | sightengine.com | https://fansreserve.com/api/moderate |

- **Variables y DNS:** las pone Carlos a mano en Vercel. Después de cambiar una variable de Preview hay que hacer **Redeploy** de la fila del PR (sin caché).
- **Nunca** pegar llaves en el chat ni en el repositorio. Los chequeos solo dicen OK/FALTA.
- **DNS:** Vercel › Domains › fansreserve.com. Nunca borrar los registros A/CNAME. DMARC está en `p=quarantine`; pasar a `p=reject` tras unas semanas limpias.
- **Riesgos conocidos antes del lanzamiento:** Vercel Hobby no permite uso comercial; Supabase free no tiene respaldos diarios. Recomendado: Vercel Pro + Supabase Pro antes de abrir.

## 9. Emergencias

| Situación | Qué hacer (con el sí de Carlos) |
|---|---|
| PayPal Live cobra mal o hay que frenar cobros | Carlos pone las 4 variables de Production en Sandbox (`PAYPAL_ENV`, client id, secret, webhook id) y hace Redeploy. |
| Hay que cerrar la web al público | La puerta "Muy pronto" ya está; abrirla o cerrarla es un cambio de una línea en el código ("lanzamos"). |
| La Mano derecha manda avisos de más | Pausar sus tareas: `select cron.unschedule(jobid) from cron.job where jobname like 'monitor-%';` |
| Retiros raros | Los automáticos ya están apagados. No reenviar nada; abrir expediente. |
| Se cayó una tarea de cron | Ver sección 4, `tareas_fallidas`. |
| Carlos pierde el celular del 2FA | Quitar su factor en `auth.mfa_factors` (solo el dueño, con SQL). |
| Filtración o contenido ilegal | Suspender la cuenta, quitar el contenido, guardar evidencia, escribir desde safety@ o minors@. |

## 10. Cómo se trabaja el código

- Cada trabajo en su propio hilo y su propio PR **en borrador**. Antes de empezar, mirar si otro hilo ya lo está haciendo.
- Se fusiona solo cuando Carlos dice **"fusiónalo"**.
- **SQL:** cada cambio es una migración nueva en `supabase/migrations/`. Las aplicadas **nunca se vuelven a correr** (salvo que el archivo diga que se puede). Si el permiso automático no deja aplicarla, se le da a Carlos el SQL listo para pegar, o se pega en su Chrome si él lo pide.
- **Probar:** con el PR abierto, en la URL de Preview de Vercel (Sandbox). Después de fusionar, en https://fansreserve.com + ruta con el link privado.
- **Pruebas antes de subir:** `npm run typecheck`, `npm run build` y las pruebas de lo que se tocó (`npm run test:*`; las de base de datos necesitan Postgres local con `PGHOST=localhost` y una base `fr_*`).
- **Carlos también trabaja con Codex** en ramas `codex/*` y fusiona él mismo. Revisar `main` antes de empezar.
- **Al final del día** Carlos suele pedir "merge todo + cronograma de mañana + estado": revisar PRs abiertos, publicar estado y plan numerado.

## 11. Consultas útiles (solo lectura)

```sql
-- Última foto de la Mano derecha
select taken_at, data->'hoy' as hoy, data->'problemas' as problemas
from monitor_snapshots order by taken_at desc limit 1;

-- Registro diario del mes
select day, closed, data->'dinero'->>'cobrado' as cobrado,
       data->'dinero'->>'fr_con_isv' as fr_con_isv, data->'dinero'->>'fr_sin_isv' as fr_sin_isv
from monitor_daily where day >= date_trunc('month', now() at time zone 'America/Tegucigalpa') order by day;

-- Reportes de las 12 y si llegaron al correo
select title, created_at, emailed_at, email_error from monitor_reports order by created_at desc limit 10;

-- Disputas abiertas
select id, kind, amount, creator_name, payer_name, created_at, paypal_ref
from transactions where status = 'disputed' order by created_at desc;

-- Retiros en curso o fallidos
select creator_name, amount, net, status, requested_at, error from payouts
where status in ('sending','failed') order by requested_at desc;

-- Tareas automáticas que fallaron en 24 h
select j.jobname, d.start_time, d.return_message from cron.job_run_details d
join cron.job j using (jobid) where d.status = 'failed' and d.start_time > now() - interval '24 hours'
order by d.start_time desc;
```

## 12. Glosario

- **Con ISV / sin ISV:** la parte de Fans Reserve antes y después de apartar el 15% de ISV. En Honduras: "neto" = con ISV, "bruto" = sin ISV.
- **Créditos:** saldo para regalos y para pagar Reserve. 100 Créditos = $1.
- **Reserve:** experiencia pagada en vivo (1:1, Meet & Greet, Evento). La videollamada 1:1 va siempre primero.
- **Fundador:** creador invitado por el equipo (100 por país) con 72% si llega a Oro en 2 meses.
- **Niveles:** Plata, Oro, Diamante (por fans activos o ventas de 30 días).
- **Ciclo:** del 26 al 25. Ventana de retiro: del 26 al día 1.
- **Preview:** copia de la web de cada PR, con PayPal Sandbox.
- **Puerta / gate:** la pantalla "Muy pronto" que esconde la web hasta el lanzamiento.
- **Expediente:** carpeta de evidencia de una venta, retiro o disputa en el admin.

## 13. Mapa de documentos

| Tema | Documento |
|---|---|
| La Mano derecha (monitoreo y reportes) | `docs/operations/mano-derecha.md` |
| Reparto 70/30 | `docs/operations/revenue-share-70-30.md` |
| Disputas, bloqueos y avisos fallidos | `docs/operations/payout-incident-procedures.md` |
| Retiros: automatización, vigilante, recuperación | `payout-automation.md`, `payout-watchdog-and-recovery.md`, `automatic-payouts.md` |
| Calendario de pagos | `payout-schedule-controls.md`, `creator-cycle-statements.md` |
| Devoluciones parciales y excepcionales | `partial-refunds.md`, `exceptional-refunds-and-recipient-changes.md` |
| Costo de cobro comprobado | `verified-collection-cost.md`, `collection-cost-reconciliation.md` |
| Cancelaciones de Reserve | `reserve-cancellation.md` (la regla de devolver al método original está en PR #159) |
| Asistencia de Reserve | `reserve-sessions.md`, `docs/reserve-attendance-city.md` |
| Reinicio de datos de prueba | `confirmed-test-finance-reset.md` |
| Seguridad antes del lanzamiento | `docs/prelaunch-supabase-security.md` |
| Varios idiomas | `docs/MULTILANGUAGE.md` |
