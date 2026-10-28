# Protección de soporte y denuncias · 27 de octubre de 2026

El visitante sigue pudiendo pedir ayuda sin registrarse. La sesión, si existe, se verifica en el servidor antes de atribuir un reporte a una cuenta. La nueva ruta no acepta una identidad ni una dirección de conexión elegidas por el navegador.

## Alcance y límites

- Ruta nueva: `POST /api/reports`. Usa las variables de Supabase ya configuradas; ninguna clave privada llega al navegador.
- La IP procede exclusivamente de `x-vercel-forwarded-for` cuando `VERCEL=1`. Vercel documenta que sobrescribe este encabezado en su borde: https://vercel.com/docs/headers/request-headers. Fuera de ese contrato de alojamiento, falla de forma cerrada.
- Se conserva un resumen HMAC de la IP, nunca la dirección en texto, durante ventanas de un minuto y una hora. Las ventanas antiguas y los recibos se eliminan de forma oportunista después de 48 horas, cuando llega otra solicitud válida. No es una garantía de borrado puntual a las 48 horas.
- Hasta cinco solicitudes por minuto y veinte por hora por conexión (ventanas fijas). Además, se conservan los límites de cinco por correo de invitado y diez por cuenta por hora. Una red compartida puede alcanzar el límite entre varias personas.
- Cada solicitud lleva una referencia aleatoria. Reintentar **la misma referencia y contenido** conserva un solo reporte, también con conexiones simultáneas. Una nueva pulsación genera otra referencia; no se promete deduplicación de mensajes parecidos.
- Los límites reducen la inserción masiva de reportes; no sustituyen protección contra una caída por tráfico excesivo ni un sistema de verificación de personas.
- No cambia pantallas, tarifas, repartos, cuentas de cobro ni procesos de pago.

## Publicación en dos fases: orden obligatorio

**No aplicar las dos migraciones juntas en producción antes de publicar la aplicación.**

1. Aplicar solamente `20261027183524_report_submission_gateway.sql`. Instala las tablas privadas y la función accesible únicamente desde el servidor; el formulario anterior sigue disponible.
2. Publicar `api/reports.ts` y el adaptador del formulario. Comprobar una solicitud legítima y los avisos de error en el despliegue publicado. El código ya no vuelve al acceso antiguo si falla.
3. Aplicar `20261027183525_close_direct_report_submission.sql`. Cierra la función anterior a visitantes y cuentas normales. Comprobar desde una sesión y desde un visitante que la nueva ruta funciona y el acceso directo antiguo es rechazado.
4. Confirmar que los controles `execution_enabled` y `batch_handoff_enabled` siguen en false. No requieren cambios para este trabajo.

Una pestaña con JavaScript antiguo puede necesitar actualizarse después del paso 3. Si se revierte la aplicación, debe incluirse una versión que conserve la ruta nueva; no reabrir la función antigua como solución rutinaria.

QA ya tiene ambas fases. La llamada HTTP local a la nueva ruta utilizó Auth y almacenamiento reales de QA; no fue un despliegue Vercel, por lo que el contrato del encabezado todavía debe comprobarse allí al publicar.

## Comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| PostgreSQL local: límites, atribución, referencias y concurrencia independiente | 10/10 |
| Ruta HTTP nativa ESM con proveedor de almacenamiento simulado | 12/12 |
| Permisos completos del visitante, fan, creador y administrador | 9/9 |
| Nueva ruta con Auth y almacenamiento alojados en Supabase QA | 5/5 |
| Auth real de QA, claves del servidor y separación de permisos | 10/10 |
| Regresión de devoluciones parciales y repetición de avisos, simulada | 37/37 |
| TypeScript y compilación | Aprobados |

El ensayo local de cierre mensual también pasó sus seis comprobaciones. Estos resultados no habilitan PayPal comercial.

## Otros avisos de seguridad

Los avisos de funciones públicas se revisan según su uso: el catálogo y las disponibilidades necesitan algunas funciones accesibles a visitantes. No debe revocarse todo el catálogo para ocultar los avisos.

La protección de contraseñas filtradas figura pendiente. Supabase la ofrece en Pro o superior: https://supabase.com/docs/guides/auth/password-security. No se ha contratado un plan ni afirmado que esté activada.

## Estado de producción

Las seis protecciones anteriores de PR113 se aplicaron el 27 de octubre. Los saldos y libros conservaron sus cantidades y los dos controles de envío permanecieron apagados. Las dos migraciones **nuevas de este cambio** se probaron en QA; no se aplicaron a producción.


