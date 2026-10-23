# Resolver diferencias del costo de un retiro

Política confirmada por el propietario el 21 de octubre de 2026. Complementa `payout-automation.md`; no habilita envíos automáticos.

## Regla económica vigente

En las ventas ordinarias, el costo de cobro se resta antes de repartir el neto. El reparto base sigue siendo 80% para el creador y 20% para Fans Reserve; niveles, referidos, regalos, descuentos y cuentas especiales conservan sus reglas. No se recalculan ventas históricas.

El creador cubre el costo real de enviar su retiro, según el contrato de creadores 6.4.3. La actualización local del 23 de octubre añade la política de Honduras en USD: 2% de lo recibido, hasta USD1 por pago. Se calcula cuánto enviar para que el dinero recibido y el costo quepa en el saldo disponible. Un posible centavo sobrante por redondeo queda en el apartado y vuelve al creador mediante este procedimiento cuando el costo se comprueba. Véase [costo de envío de Honduras](honduras-payout-cost.md). Los envíos ya preparados conservan sus importes anteriores; no se reescribe su comprobante.

La diferencia del creador es **costo estimado − costo real comprobado**. Por ejemplo, estimado USD1 y confirmado USD0.98 producen USD0.02 a su favor. No constituyen una comisión nueva de Fans Reserve. Una corrección de costos no determina culpabilidad ni sustituye las reglas de reembolsos y disputas del contrato 6.2.3.

## Revisión administrativa

1. En Pagos a creadores, abre «Comparar reportes de PayPal y banco». Importa un reporte normalizado del entorno correspondiente. Production rechaza datos marcados como prueba.
2. Abre «Revisar diferencia de comisión». Compara el estimado original, el costo confirmado por PayPal y el valor importado. La evidencia debe provenir de una consulta conciliada y entregada del mismo retiro, destinatario, importe e identificadores, con costo individual en USD. Un CSV o una captura por sí solos no autorizan un ajuste. Si falta evidencia, recupera y concilia el retiro antes de continuar.
3. Documenta el motivo y una referencia verificable del expediente. El servidor calcula el importe; el administrador no puede introducir una cifra para forzar la coincidencia. Revisa el efecto y confirma.
4. Comprueba el estado «Resuelta con evidencia y registro contable» y el historial del creador. Se conservan el retiro y el reporte importado originales. Si solo había un error del reporte y el costo real coincide con el estimado, se documenta la resolución sin cambiar el saldo.
5. Ante un acuse perdido, reintenta desde la misma revisión con la misma referencia. No crees otro ajuste manual. Una clave nueva tampoco permite resolver dos veces un retiro con resolución vigente.

Los créditos nuevos se incorporan al siguiente cierre. Los descuentos comprobados afectan el disponible actual; no se ejecuta un cobro externo ni se reescribe un lote. Un lote cuyo saldo cambió requiere nueva revisión.

## Corregir una resolución equivocada

Usa «Preparar reversión» desde su historial y documenta el motivo. La reversión compensa exactamente el ajuste y su contrapartida de comisión, conserva la fecha de elegibilidad y reabre la incidencia con un nuevo episodio de aviso. Luego puede registrarse una resolución nueva con evidencia vigente. La corrección genérica de saldo rechaza la reversión parcial de estas operaciones.

Una resolución cierra su incidencia de reporte y cancela los avisos todavía pendientes o cuya reserva de envío venció. Un correo que el proveedor ya está enviando puede llegar después del cierre; el panel conserva el estado actual.

## Evidencia o estado posterior incompatible

Si un retiro resuelto deja de estar entregado o una consulta posterior contradice el costo, el sistema congela los retiros de esa cuenta y conserva el registro del bloqueo. No libera fondos automáticamente ni reasigna responsabilidades.

Un operador debe conciliar la devolución, revisar el ajuste y cualquier reserva o retiro posterior, y dejar evidencia de la decisión. Revertir una resolución no desbloquea la cuenta por sí solo. Los [procedimientos del punto 5](payout-incident-procedures.md) añaden el expediente de responsabilidad y la liberación de cada motivo cuando sus comprobaciones lo permiten. Las incidencias deben atenderse antes de habilitar dinero automático.

## Despliegue y permisos

La migración `payout_fee_resolution` se instala antes del cliente. Su política inicia deshabilitada. La activación administrativa de la política de costo real exige una referencia al contrato vigente en `finance_private.fee_policy`; no modifica las puertas del ejecutor ni equivale a autorización comercial de PayPal.

Las tablas de resoluciones, reversiones y bloqueos son inmutables y no permiten lectura o escritura directa a roles de aplicación. Las funciones públicas de revisión validan administrador; cada creador solo obtiene su propio historial financiero. Los importes y las contrapartidas se registran en una sola transacción bajo el bloqueo contable existente.

## Validación reproducible

- `npm run test:fee-resolution`: prueba de permisos, evidencia, idempotencia, cambios posteriores, reversión, contabilidad, atomicidad e incidencias en PostgreSQL temporal sin red.
- `npm run test:fee-resolution-ui`: escritorio y móvil con componentes y adaptador reales conectados a esa base temporal; requiere una compilación previa para el estilo.
- Con `TEST_FEE_RESOLUTION=1`, ejecutar también `test:finance-ledger` y `test:finance-ui` para validar el esquema nuevo sobre los flujos existentes.
- En QA independiente se comprobó Auth real, privacidad y dos conexiones PostgreSQL distintas. Se reutilizó evidencia del retiro Sandbox anterior; no se envió otro pago para resolver su diferencia.

Pendientes ajenos a esta activación: autorización comercial escrita de PayPal, extractos reales, validación operativa humana y ensayo del ejecutor completo con carga representativa contra Sandbox nativo.
