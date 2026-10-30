# Cancelaciones de Reserve

Decidido por Carlos el 29 de octubre de 2026. Sustituye las políticas Flexible / Moderada / Estricta que elegía cada creador.

## Regla única

| Caso | Fan recibe | Creador |
| --- | --- | --- |
| Antes de pagar | Nada que devolver | — |
| Fan cancela 24 h o más antes | 100% en Créditos | No cobra esa venta |
| Fan cancela con menos de 24 h | 50% en Créditos | Conserva la mitad de su ganancia |
| Fan no se presenta | Nada | Conserva su ganancia |
| Creador cancela una reserva pagada | 100% en Créditos | No cobra y cuenta en su historial (`reward_reliable`) |
| Pagada con ticket de Meta | El ticket vuelve si la devolución es del 100% | — |

Un cambio de fecha gratis por reserva 1:1, pedido con 24 h o más. La reserva sigue confirmada en su fecha original hasta que el creador acepta.

La hora de inicio se cuenta en la zona del creador (`vip_bookings.time_zone`; Honduras para reservas antiguas sin zona).

## Cómo se registra

- `reserve_cancel(booking)`: única entrada, para fan y creador. Anota `details.cancellation`.
- La venta original no se reescribe: solo cambia `transactions.creator_refund_loss`, la misma columna de las devoluciones parciales. El libro, el estado de cuenta y los retiros lo siguen solos. Si el creador ya retiró, se descuenta de sus ingresos futuros.
- Los Créditos devueltos son filas de `credit_grants`; los pagados en Reserve, de `credit_spends`. `coin_balance` suma ambas.
- `reserve_pay_with_credits(booking)`: paga una Reserve aceptada solo con Créditos. La venta se acredita al creador como una de PayPal (método `Créditos`, costo de cobro estimado).
- No se llama a PayPal: ninguna cancelación genera un reembolso en dinero. No hagas además un reembolso en PayPal de una reserva ya cancelada con Créditos.

Constantes: `reserve_cancel_hours()` y `reserve_late_refund_percent()` en `supabase/migrations/20261030000001_reserve_cancellation.sql`, y `src/lib/reserveCancellation.ts`. Cambia ambos.

Pruebas: `npm run test:reserve-cancellation-db` (PostgreSQL local) y `npm run test:reserve-cancellation-ui` (app sin conexión, fan y creadora).
