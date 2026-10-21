# Revisión y preparación automática de pagos

Las ganancias se acumulan del 26 a las 00:00 hasta antes del 26 siguiente, en `America/Tegucigalpa` (UTC−6). La ventana de pago es del 26 al día 1 siguiente inclusive. Este cambio publica la revisión y conserva **apagado** el envío automático de dinero.

## Publicación

1. Aplicar `20261021041631_payout_batch_executor_and_reconciliation.sql` antes de publicar la API y el cliente. No altera retiros, destinatarios ni ingresos existentes. El historial financiero permanece inmutable.
2. Configurar `CRON_SECRET` en Production, conservar `RESEND_API_KEY` con acceso de envío a fansreserve.com. `PAYOUT_ALERT_EMAIL` es opcional y por defecto usa el correo del propietario, carlosguzmanfunez@gmail.com. Ningún cliente puede elegir destinatarios.
3. Publicar y verificar `/api/payout-job`: GET requiere el secreto de cron; POST requiere sesión administrativa y solo revisa. El botón de prueba de correo usa el servidor publicado sin extraer credenciales. Una prueba por destinatario/día, con referencia estable y reintentos acotados. «Aceptado» no certifica llegada a la bandeja.
4. Comprobar en el panel la última revisión y los avisos pendientes. Revisiones normales sin incidencias no generan correo. Una incidencia persistente no vuelve a avisar; si se resuelve y reaparece, abre un episodio nuevo.

## Capacidad y recuperación

El cron de Vercel está programado a las 12:00 UTC cada día. En Hobby puede ejecutarse dentro de esa hora (06:00–07:00 de Honduras); los avisos no son inmediatos. Procesa hasta cinco elementos pendientes por ejecución y tres avisos. Antes de activar dinero real se debe dimensionar la frecuencia, el volumen y la atención de incidentes: este límite diario no garantiza pagar una lista grande durante la ventana. No se contrata ningún plan nuevo con este cambio.

Una ejecución tiene una concesión de tres minutos. Otra conexión recibe `busy`; una ejecución vencida no puede completar otra. Se conserva el historial. Los avisos firmados pendientes y los lotes ya identificados se consultan también en modo revisión. Un envío incierto sin identificador solo puede reintentarse con su referencia original, reserva persistida y todos los requisitos de ejecución vigentes. Nunca se libera saldo por una excepción genérica.

El presupuesto reserva el neto más el techo de comisión, descuenta los envíos inciertos y los pagos posteriores a la comprobación de fondos. Vence a las 24 horas. Se comprueban nuevamente fondos, identidad, suspensión, disputas y saldo inmediatamente antes del envío. La comprobación manual de fondos es evidencia operativa; no sustituye la conciliación bancaria ni detecta por sí misma gastos externos posteriores.

El correo usa una cola con contenido y referencia estables, concesiones, cinco intentos y un máximo de 23 horas desde el primer intento para respetar la ventana de idempotencia del proveedor. Después requiere revisión humana; no se reenvía indefinidamente. Un receptor sin credenciales de Resend conserva los avisos pendientes.

## Requisitos antes de activar envíos

No habilitar `finance_private.automation_settings.execution_enabled`, `finance_private.settings.batch_handoff_enabled` ni `PAYOUT_AUTOMATION_MODE` hasta completar:

- Autorización **escrita** de PayPal para recaudar por cuenta de creadores y pagar mediante Payouts. Sandbox no concede esa autorización.
- Evidencia de entrega y aviso firmado, cuenta administrativa responsable, techo de comisión y conexión correcta del mismo entorno. Las credenciales y la autorización deben corresponder al entorno real.
- Pruebas de capacidad suficientes para la lista de creadores y la ventana del 26 al 1, con supervisión y recuperación operativa.
- Confirmación de recepción de alertas y procedimiento para avisos fallidos.
- Conciliación real y política contable para comisiones, ajustes y disputas.

La variable del servidor debe coincidir exactamente con el entorno y las dos puertas de base de datos deben estar activadas. Las referencias comerciales/de prueba y el presupuesto solo se cambian por administración confiable de la base; la pantalla no habilita el ejecutor. El despliegue no modifica esas puertas.

## Conciliación

El ejemplo de la pantalla permanece en el navegador y no inserta datos ficticios en Production. La plantilla CSV permite importar hasta 200 filas por solicitud, en USD y con fecha/zona horaria. También admite JSON con `source`, `external_id`, `kind`, `reference`, `amount`, `currency`, `occurred_at`. Los valores monetarios son magnitudes positivas: `payout`/`fee` se comparan con retiros; `transfer` enlaza PayPal con banco por referencia e importe. No importar dos lados como dos gastos.

La plantilla es un formato normalizado, no un lector universal de extractos originales. El administrador debe identificar correctamente las referencias. No hay conversión de divisas ni conciliación de ingresos brutos/cobros en esta versión.

Un ID externo ya importado no puede sobrescribirse con otros datos. Referencias ambiguas, retiros desconocidos, comisiones diferentes y transferencias sin contraparte quedan por revisar y bloquean el ejecutor. Coincidir por referencia e importe no certifica un estado bancario completo.

Una comisión real diferente de la estimación **no cambia el saldo del creador** ni se da por resuelta automáticamente. Hace falta definir con el contador quién asume la diferencia y registrar un ajuste documentado; esta versión no incluye una aprobación que ignore o resuelva esas diferencias. Nunca borrar el original para conseguir que coincida.

## Validación repetible

`npm run typecheck`, `npm run test:payout-automation`, `npm run build` y `npm run test:payout-operations-ui` verifican permisos, autorizaciones, idempotencia, fondos, disputas, alertas, importación y pantallas. El proveedor de esas pruebas es simulado. Las pruebas reales de Supabase y PayPal Sandbox se ejecutan únicamente en el proyecto QA independiente, con credenciales locales protegidas; no se guardan secretos en Git.
