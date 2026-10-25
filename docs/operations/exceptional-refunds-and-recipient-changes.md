# Devoluciones excepcionales y cuenta receptora

Preparado el 24 de octubre de 2026. Cambios aislados desde `main` después del PR105. **Pendiente de publicar y aplicar las dos migraciones.** No habilita envíos ni modifica tarifas, porcentajes, calendario o datos históricos.

## Qué puede hacer el administrador

En **Pagos → Expedientes → Una devolución necesita revisión** se añade una conciliación supervisada. Se conserva el aviso firmado y el comprobante consultado por el servidor. El navegador no puede introducir un comprobante PayPal, cambiar el importe devuelto ni escribir la pérdida del creador.

1. Consultar el efecto sobre la compra y las ganancias.
2. Si el contrato incluye servicio o impuestos, documentar qué parte acumulada de la devolución corresponde a esos conceptos. Dejar cero cuando no aplican. No es un cálculo ni una declaración fiscal automática.
3. Añadir referencia de los comprobantes y explicación; confirmar el desglose.
4. Revisar después causa, responsabilidad y cobertura con el procedimiento existente. Conciliar no libera las retenciones ni cobra otra vez al fan.

El servidor vuelve a comprobar toda la base al confirmar. Si cambian los comprobantes, la billetera o la venta después de consultar, exige actualizar. Cada decisión conserva su referencia para reintentar una respuesta perdida. Dos operadores no pueden aplicar el mismo comprobante dos veces.

### Créditos

Se calcula la proporción de Créditos de la compra que corresponde al dinero efectivamente devuelto. Las devoluciones acumuladas se redondean a Créditos enteros; una devolución total retira todos los Créditos originales, incluidos los bonos de ese paquete.

Primero se usan los Créditos sin gastar. Si faltan, se revierten las partes necesarias de regalos confirmados, empezando por el más reciente, siguiendo el orden de la política existente. Las billeteras agrupan compras: este orden **no afirma identificar físicamente qué compra financió cada regalo**. La vista previa hace explícita la asignación antes de aprobarla.

Ejemplo de prueba: el fan compró 10.000 Créditos por USD100 y gastó 9.000. Conserva 1.000. PayPal devuelve USD20, por lo que se retiran 2.000 Créditos de esa compra. Se consumen los 1.000 que quedaban y se revierten 1.000 del regalo más reciente. Si ese regalo reconocía 60% al creador, su ganancia disminuye USD6, sujeta a la revisión de cobertura. No se cancela todo el regalo si solo hace falta una parte. La compra, el regalo y los apuntes originales conservan sus importes; los ajustes se registran por separado.

Las siguientes devoluciones usan los totales acumulados y descuentan únicamente la diferencia. Se conservan los bonos por invitación vinculados, reduciéndolos proporcionalmente sin recalcular niveles. Si Fans Reserve ya cubre una venta, su cobertura sigue protegiendo la parte del creador. Los pagos anteriores no se borran; un ajuste puede dejar saldo por recuperar.

Una billetera con otra disputa, otro aviso de cobro pendiente, otra devolución incompatible o diferencias anteriores se mantiene bloqueada. Las compras antiguas sin datos suficientes no se fuerzan a cuadrar.

### Descuentos y contratos especiales

Se conserva lo que el fan pagó realmente y la ganancia originalmente reconocida. No se cobra otra vez el descuento ni se recalcula el nivel del creador.

Para servicio e impuestos, la parte documentada de la devolución se separa antes de distribuir la devolución neta restante con la proporción original. Hay límites por concepto y por compra. Ejemplo de prueba: cobro USD100; PayPal USD3; servicio USD5; impuestos USD15; ganancia del creador USD77. De una devolución USD20, si USD1 corresponde al servicio y USD3 a impuestos, los USD16 restantes reducen la ganancia del creador. Son cifras ficticias para comprobar el procedimiento, no nuevas tarifas ni reglas tributarias.

Si falta la comisión histórica, solo puede recuperarse del comprobante original consultado a PayPal. No se inventa una tarifa ni se sobrescribe la venta. Un reparto original incompatible, comisiones multiparte, moneda distinta o comprobante alterado sigue en revisión.

Los expedientes antiguos retenidos antes de esta mejora pueden solicitar una nueva consulta únicamente si corresponden a estas excepciones conocidas. Después se utiliza **Comprobar avisos pendientes**. Eso consulta la devolución original; no solicita otra devolución.

## Cambio de cuenta receptora

El creador escribe dos veces el correo y confirma que lo comprobó en PayPal. La base valida la sesión, la propiedad, los datos y la versión de la cuenta. El historial de cambios es inmutable; el creador ve los últimos cinco cambios con direcciones enmascaradas.

- Un envío iniciado o incierto impide cambiar el destinatario hasta conciliarlo. Sus instrucciones, importes y referencia permanecen intactos.
- Un apartado sin envío mantiene su correo e importe originales y pasa a revisión individual. Los demás creadores siguen su proceso.
- El administrador puede liberar **solo ese apartado que nunca tuvo un envío preparado**, documentando motivo y comprobantes. La liberación se registra en el libro y deja de consumir la asignación. Después hay que revisar el saldo actual y preparar un pago nuevo; no se cambia el destino del apartado anterior.
- Los controles de saldo, identidad, disputas, calendario y autorización comercial siguen vigentes.
- Preparar un retiro y cambiar la cuenta comparten el mismo bloqueo antes de leer el destinatario. Dos sesiones no pueden sustituirse silenciosamente.
- Confirmar dos veces el correo previene errores de escritura. **No verifica la propiedad de la cuenta PayPal ni sustituye una verificación de identidad o una aprobación comercial.** No se añadió un plazo de espera nuevo ni una promesa de recuperación de dinero enviado a un destinatario equivocado.

La escritura directa de `payout_accounts` queda retirada para clientes y `service_role`; solo la función autenticada del propietario puede registrar cambios. Los clientes antiguos fallan de forma segura y deben actualizarse.

## Publicación

Aplicar primero, en este orden:

1. `20261024202221_supervised_refund_resolution.sql`.
2. `20261024203212_payout_recipient_controls.sql`.

Después publicar cliente y servidor del mismo cambio. La segunda migración retira la escritura antigua del destinatario: no dejar un cliente antiguo como versión vigente tras aplicarla. Si se vuelve al cliente anterior, **no restaurar permisos de escritura ni sustituir instrucciones de retiros inciertos**; mantener deshabilitado el cambio de cuenta hasta corregir la versión.

La migración no modifica cuentas existentes ni descuenta devoluciones anteriores. `execution_enabled=false` y `batch_handoff_enabled=false` deben conservarse.

## Pruebas

- `npm run test:refund-exceptions-db`: PostgreSQL local, todas las migraciones, Créditos gastados, sucesivas devoluciones, descuentos, servicio/impuestos, evidencia incompleta, avisos alterados, historial y concurrencia con conexiones independientes.
- `npm run test:payout-recipient-db`: PostgreSQL local, sesión/propiedad, doble correo, versiones, retiros inciertos, recuperación individual en lote mixto y cambio simultáneo con preparación de retiro.
- Suites existentes de devoluciones, avisos y comisiones; tipos, compilación y calendario de revisión sin pagos.
- `npm run review:finance-controls`: abre un servidor local con componentes reales y respuestas ficticias para revisión por navegador. No utiliza claves ni habla con PayPal o Supabase. Es una prueba de interfaz separada de las pruebas SQL, no una entrega nativa Sandbox.

Los ensayos SQL exigen `PGHOST=127.0.0.1` o `localhost`, `PGPORT`, `PGUSER` y `psql` en PATH; crean y eliminan únicamente las bases desechables nombradas en cada script. Ninguna prueba envía dinero real. Los cambios nuevos todavía requieren validación integrada en QA publicado antes de producción.
