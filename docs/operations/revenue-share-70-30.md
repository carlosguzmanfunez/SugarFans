# Reparto de ganancias 70% / 30%

Decisión de Carlos: 6 de noviembre de 2026; vigencia inmediata autorizada el 7 de noviembre de 2026 como estructura inicial anterior al piloto.

| Actividad o beneficio | Creador | Fans Reserve antes de otros gastos |
|---|---:|---:|
| Suscripción, renovación, propina y Reserve ordinarios | 70% | 30% |
| Fundador activo | 72% | 28% |
| Diamante | 73% | 27% |
| Fan de enlace durante 60 días | 75% | 25% |
| Regalo | 60% del valor del regalo | 40% |

Para los pagos ordinarios, primero se resta el costo de cobrar. Se usa el costo comprobado cuando está disponible; la estimación publicada no sustituye el comprobante. No se suman entre sí los porcentajes de Fundador, Diamante y enlace: se usa el mayor que corresponda.

El bono del invitador sigue siendo el 5% del importe restante después del costo de cobro, durante seis meses desde la calificación, hasta USD100 por mes y creador invitado. Sale de la parte de Fans Reserve. La suma de lo asignado al creador y a su invitador no puede exceder el 80% de ese importe; el redondeo también respeta este límite. Los contratos especiales de Reserve con servicio del 5% conservan su regla explícita. No se encontraron cuentas especiales activas en las dos bases inspeccionadas.

## Recorrido de USD100

Ejemplo con un solo pago y costo estimado de 5,4% más USD0,30:

1. El fan paga USD100.
2. El 5,4% de USD100 son USD5,40. Sumamos USD0,30: costo de cobro USD5,70.
3. USD100 menos USD5,70 dejan USD94,30.
4. El 70% de USD94,30 son USD66,01 para el creador. Los USD28,29 restantes corresponden a Fans Reserve.
5. Cuando pueda cobrar esos USD66,01, apartamos USD1 para enviarle USD65,01 a su PayPal. El envío se comprueba después; no se vuelve a descontar la comisión de Fans Reserve.
6. Para proveedores se planifica el 15% de los USD28,29: USD4,24. Quedan USD24,05 antes de otros gastos, impuestos y obligaciones. Esto es una previsión; no mueve ni inmoviliza dinero por sí sola.

Si los USD100 llegan en cuatro pagos de USD25, cada cobro cuesta USD1,65 y deja USD23,35. El 70% da USD16,345 y se redondea a USD16,35 por pago. Fans Reserve conserva USD7,00 por pago. Totales: USD6,60 de cobro, USD65,40 para el creador y USD28,00 para Fans Reserve. La previsión para proveedores es USD4,20 y quedan USD23,80 antes de otros gastos e impuestos. El envío posterior apartaría USD1 y entregaría inicialmente USD64,40.

El reparto se redondea una sola vez por cada pago, al centavo más cercano, subiendo los medios centavos. La parte de Fans Reserve es el importe restante. No se vuelve a repartir una suma mensual: eso produciría una diferencia de dos centavos en este ejemplo.

## Diferencias posteriores, devoluciones y disputas

Se conserva la política de diferencias completas aprobada por Carlos: si el costo inicial fue USD5,70 y el comprobado es USD8, el creador tiene un ajuste de USD−2,30 para el pago del mes siguiente; si el comprobado es USD3, recibe USD+2,70. En ambos casos, la comisión original de Fans Reserve permanece en USD28,29. No se vuelve a dividir esa diferencia en 70/30. Los casos históricos conservan sus decisiones aprobadas y el creador puede pedir revisión.

Las devoluciones y disputas leen el reparto guardado del pago original. No se generan cobros, pagos, ajustes ni coberturas por el mero cambio de porcentaje. Los controles de responsabilidad y cobertura de incidencias permanecen. Tener más margen no constituye una reserva bancaria automática ni modifica las condiciones de la pasarela.

## Conservación de lo anterior

- Ninguna venta existente recibe un nuevo porcentaje. Su fracción original sigue siendo la base contable.
- Las reservas anteriores conservan la oferta anterior, aun cuando se paguen después del cambio. Las nuevas guardan la versión de su reparto en el servidor.
- Los nuevos pagos guardan el importe inicial del creador en centavos y la versión del reparto. No pueden editarse para cambiar el ingreso original; las correcciones se registran por separado.
- Se amplía la precisión de la fracción guardada sin recalcular sus valores anteriores. Un presupuesto de revisión abierto antes del cambio puede exigir recargarlo; no autoriza liberar dinero.
- No se cambian los ciclos 26–25, la ventana de pago 26–1, los mínimos, los costos de PayPal, los impuestos ni los pagos pendientes.

## Publicación y comprobación

La adopción inicial del reparto entra en vigor de inmediato el 7 de noviembre de 2026, según instrucción expresa de Carlos durante la estructuración previa al piloto. Para esta adopción inicial no se exige esperar 30 días. El Contrato de Creadores, sección 13.1.1, conserva el aviso de 30 días para cambios materiales posteriores a partir del inicio del piloto. No se enviaron avisos a usuarios. Los términos preparados pasan a la versión 1.4.0 y mantienen las incorporaciones de seguridad de la versión 1.3.0. Las aceptaciones anteriores no se sobrescriben.

En esta activación inicial: respaldar y verificar la base principal; aplicar primero `creator_revenue_70_30` y después `income_exact_cents_in_books`, y publicar servidor/cliente de forma coordinada. La primera migración fija su momento de entrada en vigor en la base de destino; aplicarla ahora corresponde a la vigencia inicial inmediata autorizada. La segunda hace que libros, saldo y estado de cuenta utilicen el importe exacto de los pagos nuevos, evitando diferencias de un centavo cuando se mezclan con fracciones antiguas. No recalcula movimientos ni ejecuta una sincronización de saldos históricos. Confirmar los porcentajes con una comprobación sin dinero y verificar que ambos controles de pagos reales sigan apagados. La autorización comercial de PayPal sigue siendo un requisito independiente.

Pruebas reproducibles: `npm run test:revenue-share`, `npm run test:incentives`, `npm run test:collection-cost-db`, `npm run test:monthly-costs`, `npm run test:credits-ledger`, `npm run test:refund-exceptions-db`, `npm run test:special`, `npm run test:reserve-discount-db` y `npm run test:creator-statement`, con PostgreSQL desechable local. La compilación y las comprobaciones de tipos se ejecutan por separado.

El prototipo Finance independiente no es la contabilidad activa. Sus datos y reportes históricos no deben presentarse como movimientos reales ni como evidencia del nuevo reparto.
