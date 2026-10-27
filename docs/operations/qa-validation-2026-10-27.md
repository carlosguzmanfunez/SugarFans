# Validación operativa · 27 de octubre de 2026

Se aplicaron a la base principal las seis protecciones de PR113, agrupadas en la actualización `release_pr113_security_guardrails` y registradas también con sus seis versiones originales. La comparación anterior/posterior de compras, Créditos, ingresos del creador, libro y pagos no mostró diferencias: todos los totales seguían en cero. `execution_enabled=false` y `batch_handoff_enabled=false`.

El recorrido de la versión publicada se hizo con la cuenta propietaria: Fan → Creador → Administrador → Fan. Los permisos de cuentas normales independientes se comprobaron con las tres cuentas sintéticas de QA; el selector del propietario no se utilizó como prueba de aislamiento de usuarios normales.

## Cierre mensual y seguridad

- Cierre mensual local: 6/6, con casos de devolución y cambio de destinatario separados del creador sano.
- Nueva protección de reportes: PostgreSQL/concurrencia 10/10, ruta HTTP 12/12, permisos 9/9 y ruta local conectada a Auth/almacenamiento alojados QA 5/5.
- Auth real QA y separación por roles: 10/10.
- Regresión de devoluciones parciales, firmas falsas y repetición de avisos, simulada: 37/37.
- Total: 89 comprobaciones, más el ensayo nativo siguiente. TypeScript y compilación aprobados.

La primera vista previa de la nueva ruta detectó una dependencia de módulos del navegador que no resolvía Node ESM; se separó la validación en `src/lib/reportRules.ts` y se cambió la prueba HTTP para preservar imports nativos, sin bundle. Se añadió además la comprobación de configuración pública del servidor: Vite carga `.env.production` durante la compilación; la función conserva los mismos valores públicos por defecto que las APIs existentes y exige siempre una clave privada desde Vercel.

## Una devolución nativa Sandbox

Proyecto QA: `pcxblbctafwmijfcwgdd`. Se utilizó solamente `api-m.sandbox.paypal.com`, con controles de red que impiden PayPal LIVE y acceso al proyecto Supabase principal desde el ensayo.

| Paso | Resultado |
| --- | --- |
| Compra de Créditos `bolsita` | USD 4,99 ficticios |
| Créditos antes / tras compra / tras devolución | 0 / 500 / 0 |
| Pedido | `0GY01248HS3022223` |
| Cobro | `60151334MK7483123` |
| Devolución | `01C53704YM793100F` |
| Aviso firmado | `WH-91634423JN8983252-6HT36725UL1251221` |
| Aviso de devolución | Firma PayPal verificada; HTTP200, aplicado |
| Repetición del mismo sobre firmado | HTTP200; conserva un solo comprobante, saldo 0 |
| Retirada de recursos temporales | Webhook eliminado; receptor y túnel cerrados después de completar la entrega |

El cobro se recuperó tras una sesión QA vencida, usando el mismo pedido aprobado. No se creó una segunda compra. El ensayo de Auth ahora termina solo su propia sesión con `scope: local`, para no invalidar otras pruebas concurrentes del mismo usuario sintético.

El comprobante Sandbox indicó USD 0,54 de comisión devuelta. Este dato no acredita una tarifa comercial. El campo de seguimiento de cancelación de suscripción permanece en false porque esta compra fue de Créditos y no requiere cancelar una suscripción.

Los sobres originales con firma y datos de prueba permanecen cifrados en el equipo; no se subieron a GitHub.

## Publicación y pendientes

[PR115](https://github.com/carlosguzmanfunez/SugarFans/pull/115) contiene la protección de reportes en revisión, sin fusionar. Sus dos migraciones nuevas están aplicadas a QA y **no** a producción. Seguir el [orden de publicación en dos fases](report-submission-gateway.md); no cerrar el acceso antiguo antes de publicar la nueva ruta.

La protección de contraseñas filtradas requiere Supabase Pro o superior y no se contrató ningún plan. Los avisos de funciones públicas se revisan según su propósito; no se revocó indiscriminadamente el catálogo. El panel conservaba dos fallos anteriores por referencias a archivos de pantallas de despliegues pasados, del 26 y 20 de octubre, que no se reprodujeron en este recorrido.

La autorización comercial de PayPal, las tarifas efectivas de la cuenta y la conciliación con extractos/depósitos reales siguen pendientes antes de habilitar dinero real.

