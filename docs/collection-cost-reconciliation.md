# Costos de Créditos y cobros anteriores

## Regla aprobada por Carlos

Si Fans Reserve descontó de más al creador por una estimación del costo de cobro, se devuelve la diferencia que corresponde a su proporción original. Si estimó de menos, Fans Reserve asume ese error: no añade un descuento retroactivo al creador. El reparto original de los regalos se conserva; el modelo ordinario sigue entregando el 60% de su valor al creador.

El costo de recibir el pago del fan y el costo de enviar dinero al creador son servicios diferentes. Esta entrega no modifica el costo del envío ni vuelve a descontar el 20% de Fans Reserve.

## Ejemplos ficticios

Un fan pagó USD 100. Se guardaron USD 5,70 como costo estimado. Los USD 94,30 restantes se repartieron al 80% para el creador: USD 75,44. El comprobante posterior demuestra que PayPal cobró USD 3. La diferencia de costo es USD 2,70. Al creador le corresponde el 80% de esa diferencia: USD 2,16. Su venta conserva USD 75,44 y un abono separado añade USD 2,16; entre ambos, USD 77,60.

Si el comprobante hubiera mostrado USD 8, faltaban USD 2,30 respecto de los USD 5,70 estimados. Fans Reserve asume esos USD 2,30; no rebaja los USD 75,44 originales del creador.

Una compra de Créditos de USD 100 con costo comprobado de USD 3 conserva todas las unidades compradas. Si después se envía un regalo cuyo valor es USD 100, el creador recibe USD 60. No se genera otro cobro de PayPal al gastar los Créditos. El resultado de esos cobros y repartos sería USD 37 antes de ajustes y otros gastos. Los Créditos todavía sin usar no se presentan como dinero libre de la plataforma; su valor para regalar puede incluir unidades extra del paquete.

## Uso administrativo

1. Abrir Finanzas → «Costos de Créditos y cobros anteriores».
2. Elegir el cobro por creador, importe, fecha y referencia. Se muestran 50 por página.
3. Consultar el comprobante original. El servidor obtiene únicamente información de ese cobro y de su pedido o suscripción registrados. No cobra, devuelve, compra Créditos ni envía un pago.
4. Comparar el costo guardado con el comprobado. Un valor desconocido no se convierte en cero. Si el costo de Créditos antiguos no se guardó, la comparación se identifica como una estimación calculada ahora.
5. Revisar el abono propuesto, los comprobantes y las correcciones previas. Documentar el motivo y confirmar expresamente la conciliación.
6. Descargar el registro completo en CSV para revisión contable. La descarga no queda limitada a la primera página ni a las primeras 1.000 filas.

La consulta guarda el comprobante en un registro privado. La conciliación conserva su decisión, autor, referencia, motivo y base original. Un abono nuevo se incorpora al siguiente cierre según su fecha, sin cambiar la fecha de la venta.

## Protección posterior

- La repetición de una respuesta perdida conserva la referencia de consulta o decisión y no produce dos abonos.
- Una devolución o disputa posterior ajusta solamente el abono vinculado a esa venta. Una resolución favorable puede restablecerlo, conservando su historial y fecha de incorporación.
- Las devoluciones parciales que incluyen servicios o impuestos usan el desglose supervisado ya guardado. Si falta, se conserva un bloqueo para revisión.
- Una reversión manual queda reflejada en el saldo de ajustes y coloca un bloqueo. El seguimiento automático no intenta compensarla otra vez.
- Se conservan los apartados, las instrucciones de pago, sus destinatarios y los fondos de un envío por confirmar. Conciliar un costo no libera ningún bloqueo ni inicia un pago.
- Solo se vuelve a poner en revisión normal el aviso del mismo cobro que quedó pendiente exclusivamente por la diferencia histórica de costo. No se dan por resueltos otros motivos ni se elimina su evidencia.

## Casos que requieren revisión adicional

No se calcula un abono cuando faltan la base original, la identificación del propietario o una referencia única. Las ventas que ya tenían devoluciones o disputas antes de esta conciliación conservan su revisión. Cuando existe una bonificación por invitación y habría que aumentar el derecho del creador, hay que revisar primero sus límites e historial; no se deduce su contrato a partir del porcentaje actual del perfil.

Un comprobante contradictorio no reemplaza al primero. El panel muestra el problema incluso si la corrección ya estaba aprobada. En ese caso se abre un expediente y, si corresponde a una venta de creador, se bloquea únicamente a su propietario. No se hace un segundo descuento. Una consulta posterior válida no libera ese bloqueo: requiere revisión humana.

## Alcance de los libros

Los abonos y sus cambios quedan en los libros operativos de saldos de creadores. El resumen usa los costos comprobados de Créditos y ventas, conserva las comisiones que PayPal no devolvió y distingue los costos todavía estimados. Los saldos de creadores se obtienen de sus movimientos y apartados, incluyendo ajustes.

Esto no convierte ese resumen en una contabilidad bancaria o fiscal completa. El resultado de cobros y repartos se identifica como anterior a ajustes y otros gastos. Siguen pendientes los extractos reales, la conciliación bancaria, las tarifas efectivas de la cuenta y la autorización comercial escrita de PayPal.

## Instalación y verificación

Aplicar, en orden, `20261025222155_credit_collection_costs.sql` y `20261025232035_collection_cost_conflict_review.sql` antes de publicar servidor y cliente. Las migraciones no consultan PayPal, no crean abonos y no reescriben ventas ni compras históricas. No cambiar `execution_enabled` ni `batch_handoff_enabled`.

Pruebas reproducibles con Node y PostgreSQL local desechable:

```text
npm run test:collection-reconciliation
npm run test:finance-controls
npm run e2e:paypal
npm run typecheck
npm run payout:schedule:check
npm run build
npm run review:collection-costs
```

Los ensayos utilizan comprobantes y respuestas de proveedor simulados; no equivalen a una entrega nativa nueva de PayPal Sandbox. La revisión visual usa el componente real con ejemplos ficticios y no solicita credenciales.
