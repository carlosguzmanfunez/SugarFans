# Devolución parcial con un costo ya corregido

Este control corresponde a una venta que ya tiene aprobada una diferencia completa del costo de recibir el pago. Comprar Créditos, los regalos y las decisiones antiguas mantienen sus reglas anteriores.

1. Primero se guardan y concilian los comprobantes de la devolución. El importe devuelto y la parte de la comisión que PayPal devuelve deben coincidir con lo registrado. Servicios e impuestos necesitan su desglose documentado, cuando correspondan.
2. En Administración → Pagos a creadores → Costos de Créditos y cobros anteriores, selecciona la venta. Verás la devolución, el descuento ya registrado y el ajuste de costo que se conserva.
3. Comprueba ambos documentos y escribe una explicación para el creador. La revisión no solicita otra devolución, no descuenta otra vez y no mueve el ajuste al mes corriente.
4. Después revisa el expediente: todavía hace falta decidir la responsabilidad de la devolución y atender todos sus demás bloqueos. La revisión de costos no libera nada por sí sola. Los pagos inciertos conservan sus importes y destinatarios.
5. Si llega otra devolución o cambia quién la cubre, se exige otra revisión. La anterior permanece en el historial. Repetir el mismo aviso o recuperar una respuesta perdida no crea otra decisión ni vuelve a congelar un caso ya revisado.

Ejemplo: fan USD 100; costo estimado USD 5,70; creador inicialmente USD 75,44; Fans Reserve USD 18,86. Luego se comprueba costo USD 3: se conserva el abono completo USD 2,70 para el creador. Una devolución posterior de USD 40, sin comisión devuelta, ya descuenta USD 32 al creador. Queda USD 75,44 − USD 32 + USD 2,70 = USD 46,14 para el creador. Fans Reserve queda con USD 18,86 − USD 8 = USD 10,86 por la devolución. USD 40 devueltos + USD 3 de costo + USD 46,14 + USD 10,86 = USD 100. El abono sigue esperando el pago mensual del mes siguiente; el total de la venta no significa que todo pueda retirarse hoy.

Si el costo comprobado fuese USD 8, se conserva el descuento completo USD 2,30: USD 75,44 − USD 32 − USD 2,30 = USD 41,14 para el creador. La revisión no añade otro USD 32 ni vuelve a repartir la diferencia al 80/20.

Una devolución que exceda el reparto disponible, una reversión manual, pruebas contradictorias o avisos pendientes conserva su bloqueo. El sistema no inventa un descuento adicional ni una cobertura de Fans Reserve para hacer coincidir las cifras. Una cobertura necesita la decisión documentada del expediente existente.

La nota del creador identifica lo devuelto, lo ya descontado y el ajuste de costo conservado. No muestra la evidencia administrativa ni datos de otras cuentas. Una nota anterior se identifica como tal cuando existen movimientos posteriores.

Implementación: `finance_collection_refund_preview` y `finance_collection_refund_review` son accesos administrativos con verificación de sesión y permisos. La segunda conserva una referencia estable y exige que los importes sigan iguales a los revisados. La decisión es privada e inmutable. La liberación sigue pasando por `finance_case_act` y sus verificaciones anteriores, más este control.

Pruebas: `e2e/collection-refund-review-postgres.mjs` utiliza Postgres local desechable y comprobantes ficticios. Incluye conexiones independientes, respuestas perdidas, cambios posteriores, permisos y conservación de los saldos y asientos. `e2e/collection-refund-review-ui.mjs` muestra los componentes reales con ejemplos ficticios para revisar escritorio y ancho móvil. No es una prueba de una devolución nueva en PayPal nativo.

Aplicar la migración antes de publicar el cliente. No se activan pagos ni se resuelve retroactivamente ningún expediente al instalarla.
