-- Reembolso completo de una suscripción (Carlos, 2026-11-10).
--
-- Con el reparto 70/30, creator_share se guarda con 16 decimales (p. ej. una
-- suscripción de USD 7.99 deja 5.08 al creador → 0.6357947434292866). Al
-- reembolsarla completa, la pérdida del creador es amount*creator_share =
-- 5.07999999999999998…, que la columna numeric(18,8) redondea a 5.08000000.
-- La regla transaction_refund_bounds comparaba contra el valor sin redondear
-- y rechazaba el reembolso: si perdíamos una disputa o devolvíamos el mes, el
-- reembolso no se registraba.
--
-- Arreglo: comparar contra el mismo redondeo que guarda la columna (8
-- decimales). No cambia ningún importe ni reparto; solo deja de rechazar una
-- diferencia de menos de 0.00000001.
alter table public.transactions drop constraint transaction_refund_bounds;
alter table public.transactions add constraint transaction_refund_bounds check (
 refunded_amount>=0 and refunded_amount<=amount and refunded_amount::text<>'NaN'
 and refunded_gateway_fee>=0 and refunded_gateway_fee<=refunded_amount and refunded_gateway_fee::text<>'NaN'
 and creator_refund_loss>=0 and creator_refund_loss<=round(amount*creator_share,8) and creator_refund_loss::text<>'NaN');
