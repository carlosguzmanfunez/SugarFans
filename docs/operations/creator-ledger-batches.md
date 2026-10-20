# Ledger de creadores y reservas por lote — punto 4

Este cambio añade el subledger operativo de las obligaciones con creadores. Cada asiento persistido contiene un debe y un haber del mismo importe en USD; esa estructura impide representar un asiento descuadrado. El historial de asientos, revisiones, asignaciones y correcciones rechaza UPDATE/DELETE. Las correcciones añaden movimientos y las reversiones conservan su vínculo con el original.

No es todavía la contabilidad completa de Fans Reserve. No determina reconocimiento fiscal de ingresos ni impuestos, no convierte cuentas puente en efectivo bancario y no certifica conciliación PSP/banco. Las compras de Créditos, obligaciones con fans, impuestos e ingresos/gastos de la plataforma necesitan sus propios libros y conciliación. El Libro de movimientos anterior se conserva como reporte.

## Qué incorpora

- Fuentes de ganancias por transacción, importe en centavos, revisión y fecha de acreditación; se conserva la instantánea financiera de cada revisión.
- Asientos por ganancias, cambios de share, reembolsos, disputas, cobertura de la plataforma, reserva, envío, confirmación y devolución de retiros.
- Lote operativo de varios creadores, un cierre exclusivo y versiones. Los importes bruto/neto/comisión estimada y el destinatario quedan fijos. Cada porción reservada apunta a una fuente y revisión concretas.
- Un solo lote activo por cierre. Liberar un lote sin envíos conserva su versión y permite preparar otra. Se rechaza liberar un lote que ya tenga retiros preparados, incluso si sus resultados todavía son inciertos.
- Los retiros manuales y los lotes utilizan el mismo presupuesto y las mismas asignaciones. Apartar un lote reduce inmediatamente el disponible del servidor. Pasar una reserva a retiro en proceso no descuenta dos veces.
- Correcciones administrativas con motivo, referencia única por creador, autor y clave de idempotencia. Los créditos nuevos se acreditan en el siguiente corte; los débitos reducen el disponible enseguida. Una reversión exacta conserva la fecha de acreditación del original.
- Pantalla administrativa «Pagos a creadores», detalle de ganancias asignadas, correcciones/reversiones, balance acumulado y exportación mensual de asientos CSV. Los CSV contienen ambos lados de cada asiento y neutralizan fórmulas en texto.
- Saldos de creadores obtenidos del servidor, incluyendo reservas y correcciones. Un error o una respuesta antigua no restaura un cálculo incompleto en el navegador. Los saldos se actualizan al modificar la plataforma, al volver a la ventana y cada 30 segundos mientras está visible; no es un canal Realtime.

## Calendario y centavos

Los ciclos acumulan desde el 26 a las 00:00 hasta terminar el 25 siguiente, en America/Tegucigalpa. Se usa un límite exclusivo del 26 a las 00:00; la pantalla muestra el cierre del 25 a las 11:59 p. m. La ventana para reservar/preparar nuevos pagos continúa del 26 al 1, inclusive. Conciliar un envío existente sigue permitido después de la ventana.

El saldo acreditado conserva la fórmula aprobada: redondear a dos decimales el total acumulado de participaciones, no redondear cada venta por separado. Los centavos se atribuyen mediante diferencias de prefijos ordenados por fecha e ID de transacción. La suma de fuentes anteriores a cualquier corte coincide con el saldo acreditado de la fórmula previa. Reembolsos o cambios de share pueden redistribuir centavos entre fuentes; se registran revisiones y ajustes sin editar asientos anteriores. El pendiente es el remanente contable, por lo que puede corregir diferencias de un centavo de la antigua suma de redondeos separados.

Las reservas incluyen el arrastre no pagado de ciclos anteriores. No se incorporan al importe ya congelado las ganancias nuevas, los cambios de destinatario ni las correcciones posteriores.

## Ejemplo de una obligación de USD 160

| Operación | Debe | Haber | Importe |
| --- | --- | --- | --- |
| Ganancia reconocida para el creador | Puente de ganancias por conciliar | Ganancias de creadores | 160.00 |
| Apartar lote | Ganancias de creadores | Apartado para lotes | 160.00 |
| Preparar retiro | Apartado para lotes | Enviado, por confirmar | 160.00 |
| Confirmar entrega | Enviado, por confirmar | Pagos confirmados por conciliar | 156.80 |
| Comisión de retiro estimada | Enviado, por confirmar | Comisión estimada por conciliar | 3.20 |

La política de comisión de retiro existente sigue siendo una estimación. El costo efectivo del proveedor, las comisiones no devueltas y las diferencias con banco deberán conciliarse; el subledger no supone que una cuenta puente sea saldo disponible en PayPal. Una devolución revierte las partidas correspondientes y restaura la obligación según la política vigente del servidor. Una entrega tardía que reabre un failed vuelve a consumir sus asignaciones originales y puede producir deuda; se preserva ese déficit.

## Retenciones y cambios posteriores al cierre

El cálculo identifica identidad no verificada, suspensión, retiros congelados, destinatario ausente, propietario ambiguo, retiro en proceso, disputa sin cobertura, saldo negativo y mínimo pendiente. Los creadores con observaciones quedan en el detalle del lote sin reservar sus importes. Las disputas no cubiertas también impiden iniciar retiros manuales, para que ese camino no omita la revisión del lote.

Si un cambio financiero deja una fuente reservada por debajo de sus asignaciones, mueve su acreditación fuera del corte o vuelve negativo el disponible, el ítem pasa a revisión y su reserva se mantiene. Una corrección posterior que restaura el saldo no borra automáticamente esa revisión; se requiere liberar el lote sin envíos y crear una versión nueva. Los ítems con envío conservan sus referencias y se concilian mediante el flujo de los puntos 2 y 3.

La preparación futura vuelve a comprobar identidad, cuenta, restricciones, mínimo, comisión, saldo y fuentes asignadas. Una cuenta PayPal cambiada no reemplaza el destinatario congelado.

## Ejecución y permisos

`finance_batch_prepare_payout` es exclusivamente del servidor y no realiza HTTP. El contrato crea un retiro individual y su snapshot con los importes del ítem; su referencia estable se integra con la recuperación existente. El lote operativo puede agrupar varios creadores, pero este cambio no construye una petición PayPal de múltiples destinatarios ni un ejecutor automático.

La puerta privada `finance_private.settings.batch_handoff_enabled` se instala en false. No hay interfaz, endpoint ni scheduler para habilitarla. Las pruebas la habilitan únicamente en PostgreSQL temporal para validar el contrato. No habilitarla en producción hasta completar el punto 5.

Las ocho tablas públicas nuevas tienen RLS y ningún acceso directo de anon, authenticated o service_role. Los RPC de administración requieren `auth.uid()` y el rol administrativo almacenado en profiles. El RPC de saldo no acepta un usuario arbitrario: consulta exclusivamente al creador autenticado. Las funciones auxiliares y los ajustes de ejecución están en un esquema sin acceso de esos roles. No se utiliza user_metadata para autorizar.

Los cambios contables se serializan con un advisory lock de transacción. El libro no adquiere locks de filas de transacciones ni modifica retiros existentes desde las operaciones de reserva. El inicio manual conserva la exclusión por perfil con NO KEY UPDATE, compatible con los locks de claves de las referencias. Los presupuestos y asignaciones vuelven a comprobarse dentro de la transacción. No se mantiene un lock durante llamadas de red. Falta validar este orden con conexiones PostgreSQL independientes.

## Instalación y apertura

La migración `20261020032222_creator_ledger_batch_reservations.sql` requiere los puntos 1–3. Bloquea escrituras en transacciones y retiros mientras obtiene la apertura y crea sus triggers. La duración de la apertura depende del historial de ganancias por creador; revisar volumen y programar el despliegue antes de aplicarla.

**Precondición deliberada:** si existe cualquier retiro histórico, la migración se rechaza. No inventa asignaciones FIFO para pagos del pasado ni modifica el historial para hacerlos encajar. En ese caso, preparar y revisar una migración de apertura con evidencia antes de continuar. Las transacciones existentes se importan como instantánea del estado conocido al instalar el libro; no se inventa su secuencia histórica de eventos.

Orden de publicación:

1. Verificar main, migraciones anteriores, recuentos y firmas del historial/saldos, además de la precondición de retiros históricos.
2. Aplicar únicamente esta migración; verificar saldo acreditado sin cambios, asientos equilibrados, RLS/permisos y puerta de ejecución en false.
3. Publicar servidor/cliente juntos para que las pantallas utilicen el saldo que incluye las reservas.
4. Verificar el calendario y una lectura del saldo; no preparar envíos reales para probar la instalación.

No borrar asignaciones ni asientos para deshacer una reserva. No restaurar `request_payout`, `paypal_payout_mark` ni errores que liberen envíos inciertos. Conservar la base de datos y sus reservas durante un rollback de aplicación; mantener detenida la ejecución de lotes. Las cuentas con historia financiera requerirán conservar o anonimizar el registro en lugar de borrar retiros.

## Validación

- `npm run test:finance-ledger`: SQL real en PGlite, con apertura, centavos, corte, versiones, reservas, duplicados, retiros manuales, disputas, reembolsos, permisos, errores de escritura y handoff virtual.
- `npm run test:finance-adapter`: contratos RPC, referencias, saldo con reserva/correcciones, aislamiento del demo, recuperación de eventos de retiros ya pagados y seguridad del CSV.
- `npm run test:finance-ui` después de `npm run build`: React y adaptador reales contra un puente HTTP local con los RPC SQL reales, autenticación de prueba y red externa bloqueada. Incluye acuse perdido, reintento, correcciones, reversión, liberación, escritorio, móvil y protección del saldo del creador frente a respuestas atrasadas/fallos de conexión.
- `TEST_FINANCE_LEDGER=1 node e2e/payout-recovery.mjs`: las 65 regresiones de recuperación/eventos con el ledger instalado. No deshabilita triggers para que pasen.

Las pruebas de PGlite usan una conexión. No certifican concurrencia entre sesiones independientes ni firmas/API de cuentas PayPal Sandbox reales. Antes de habilitar un ejecutor siguen pendientes esos ensayos, la orquestación/outbox, la conciliación de fondos PSP/banco/fees y las alertas de incidencias agrupadas en dashboard y correo. Las bandejas durables de disputas, reembolsos de cobros y suscripciones continúan pendientes.

Referencias de implementación: [triggers y tablas de transición de PostgreSQL](https://www.postgresql.org/docs/current/sql-createtrigger.html), [bloqueos y compatibilidad de locks](https://www.postgresql.org/docs/current/explicit-locking.html), [aritmética NUMERIC](https://www.postgresql.org/docs/current/datatype-numeric.html).
