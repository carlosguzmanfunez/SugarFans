# Costo de enviar pagos a creadores desde Honduras

Política aprobada por Carlos el 23 de octubre de 2026. Actualización de base aplicada el mismo día; servidor y cliente se publican conjuntamente con devoluciones parciales y recuperación de avisos. Moneda USD, cuenta pagadora de Honduras. No cambia el cobro al fan ni el reparto previo entre Fans Reserve y el creador.

## Regla y ejemplo

PayPal publica el 2% del importe enviado, con máximo de USD1 por pago individual. El creador cubre el costo real según el contrato vigente. El máximo se aplica a cada destinatario; un grupo de 50 pagos no comparte un único máximo de USD1.

Si el creador ya tiene USD100 disponibles después del reparto, se calculan USD99 para recibir en PayPal. El 2% de USD99 es USD1,98; con el máximo publicado, el costo previsto es USD1. USD99 + USD1 = USD100.

| Saldo que incluye el envío | Recibiría el creador | Apartado para PayPal |
| --- | --- | --- |
| USD25 | USD24,51 | USD0,49 |
| USD50 | USD49,02 | USD0,98 |
| USD75,44 | USD74,44 | USD1 |
| USD100 | USD99 | USD1 |

## Cálculo, centavos y costo comprobado

`payoutFee(balance)` y `public.payout_fee(p_amount)` reciben el saldo completo que incluye el envío, no el importe transferido. Ambos operan con centavos enteros y buscan el mayor envío que cabe junto a `min(round(envío × 0.02, 2), 1)`. El resultado es el apartado para el costo, `saldo − envío`, con máximo de USD1.

Para saldos de al menos USD51 existe una salida directa de costo constante; no se recorren importes. Por debajo se utiliza búsqueda binaria. El dinero sigue cuadrando en los contratos actuales: `amount = net + fee`, las asignaciones y los dos lados del diario.

El redondeo puede impedir gastar exactamente todo el saldo con un importe y un costo expresados en centavos. Ejemplo: de USD50,74, se pueden enviar USD49,74. El 2% es USD0,9948, previsto como USD0,99. Enviar USD49,75 exigiría USD1 de costo redondeado y sumaría USD50,75, por encima del saldo. Por eso se mantienen USD1 dentro del apartado hasta comprobar el costo. El centavo sobrante no es ingreso de Fans Reserve. Se devuelve al saldo mediante el procedimiento de costo real existente, con evidencia individual e historial inmutable. Los créditos siguen su fecha de elegibilidad habitual; no se envía un pago adicional automáticamente.

El procedimiento de costo real conserva sus permisos, evidencia, activación y revisión actuales. No se habilita esa política ni se otorga una aprobación administrativa automáticamente. Un costo que no corresponda a la tarifa esperada requiere revisión; la cifra mostrada no reemplaza el comprobante de PayPal.

## Preservación del historial y reservas previas

La migración solo cambia el cálculo de pagos nuevos. No actualiza importes de `payouts`, `paypal_payout_submissions`, asientos o asignaciones ya registrados. Recuperar un envío pendiente mantiene su referencia y petición originales, incluidos los importes preparados con la regla anterior. Sus diferencias se resuelven contra el costo real, sin repetir el envío.

Los elementos de lote todavía sin un retiro preparado y cuyo costo ya no coincide pasan a `review`, con motivo `PAYOUT_FEE_POLICY_CHANGED`. Conservan importe, asignaciones y reserva; no liberan dinero automáticamente. El administrador cancela el apartado anterior con motivo documentado y prepara uno nuevo. La nueva cotización invalida una vista anterior. Los grupos espejo muestran el motivo en lenguaje cotidiano.

El presupuesto de seguridad para disponer de fondos en la cuenta pagadora no es un descuento al creador. La migración no cambia ese presupuesto ni sus autorizaciones; el ensayo virtual utiliza ahora USD100 por creador y explica sus USD99 + USD1.

## Cambios visibles y despliegue

Se actualizan el desglose de Ingresos del creador, los términos generales y contrato de creadores en `/legal`, y el ensayo virtual. La pantalla muestra de dónde sale el porcentaje y suma lo que recibiría con lo que se aparta. No cambia los porcentajes de ventas, incentivos, regalos, cuentas especiales ni el calendario 26–25 / pago 26–1.

Aplicar `20261023191333_honduras_payout_cost.sql` antes de publicar servidor y cliente, con las puertas de dinero apagadas. Revisar los lotes anteriores marcados para volver a preparar. La rama incluye además las entregas locales de devoluciones parciales y recuperación de avisos; revisar ese conjunto de dependencias antes de publicar. No restaurar ni modificar migraciones históricas.

## Verificación

- `npm run test:honduras-payout-cost`: SQL real en PGlite, cálculo de pantalla, 6.201 saldos consecutivos en centavos, casos históricos, nuevas reservas, 50 creadores y devolución documentada de un centavo.
- `npm run test:honduras-payout-cost-ui`: explicación real y cotizaciones SQL en móvil/escritorio, sin llamadas externas ni pagos.
- `node e2e/honduras-payout-cost-postgres.mjs`: todas las migraciones, reparto real de propina, retiro y petición inmutable en PostgreSQL local desechable. Requiere `PGHOST` local, `PGPORT`, `PGUSER`, `psql` en PATH. Crea y elimina únicamente `fr_hn_payout_cost_test`. `FANSRESERVE_ADVISOR_BIN` permite ejecutar los asesores de Supabase sobre esa base local.
- Repetir calendario, ajustes de costo, seguridad de revisión, ensayo virtual, tipos y compilación.

Esta entrega no ejecuta pagos PayPal Sandbox ni reales. La aprobación comercial de PayPal y cualquier condición especial de la cuenta siguen pendientes.

Fuentes verificadas el 23 de octubre de 2026: [tarifas de PayPal Honduras](https://www.paypal.com/hn/business/paypal-business-fees), secciones de Pagos en serie y máximo USD1 de «Todos los demás mercados»; [costo y fondos necesarios](https://developer.paypal.com/limited-release/payouts/reference/fees).
