# Aceptación con Supabase QA y PayPal Sandbox

Ensayo del 21 de octubre de 2026. **Aceptación parcial; no habilitar dinero real ni aprobar todavía una ejecución de cincuenta sin intervención.**

## Resultado observado

Se usaron 75 identidades creadoras nuevas y una adicional bloqueada por identidad. Las ganancias eran sintéticas; la API del ejecutor, Supabase alojado, OAuth, solicitudes de PayPal Sandbox, consultas de entrega y verificación de firmas fueron reales. Cada destinatario fue la misma cuenta Personal Sandbox verificada. No se probaron 1.000 destinatarios nativos distintos ni el cron publicado en Vercel.

| Ensayo | Resultado |
| --- | --- |
| Capacidad configurada 25 | 25 pagos confirmados |
| Capacidad configurada 50 | 49 confirmados y uno conservado en revisión manual |
| Total | 75 retiros originales, 74 confirmaciones contables; USD 3.626 ficticios entregados |
| Caso retenido | USD 50 brutos, neto previsto USD 49; cinco intentos de recuperación, sin lote del proveedor registrado |
| Creador bloqueado adicional | Cero retiros creados; permaneció separado de los sanos |

No se cambió el contador, el importe ni la referencia del caso retenido para hacer pasar la prueba. No se liberaron sus fondos. Los intentos se consumieron durante la recuperación del propio ensayo, incluida una consulta del operador que reclamaba el envío antes de comprobar si podía someterse. Esto no demuestra cinco transferencias a PayPal ni un error del creador.

Se recibieron y verificaron 35 avisos firmados, incluidos 11 de éxito individual. Nueve respondieron inicialmente HTTP 503 después de guardar el evento; posteriormente se conciliaron, y los 35 quedaron en estado `reconciled`. Es una muestra de notificaciones, no una afirmación de que cada una de las 74 entregas haya tenido un aviso individual capturado. Las demás confirmaciones se obtuvieron consultando PayPal con la misma referencia.

## Incidencias y correcciones

El proceso encontró demoras de infraestructura, una respuesta de inicio incompleta y una interrupción que conservó la espera general de seguridad. Se conciliaron los envíos existentes y se registró una decisión de seguimiento en el expediente antes de levantar exclusivamente ese control en QA. Los siguientes pagos continuaron con las referencias originales.

Se corrigió el servidor para rechazar JSON truncado, devolver HTTP 503 si no confirma el inicio y exigir el booleano `true` exacto como autorización final. Catorce pruebas virtuales conservan concesiones y reservas, no contactan al proveedor ante respuestas inválidas y completan después una sola confirmación. Las 33 regresiones del ejecutor también pasan. La recuperación posterior del ensayo utilizó este servidor corregido.

El archivo cifrado de evidencias del equipo alcanzó el límite de SecureString. El fallo ocurrió en la instrumentación local, antes del HTTP de un intento; se conservó ese intento en la evidencia y se corrigió el almacenamiento protegido mediante compresión. Esa pausa no debe atribuirse a un HTTP 503 emitido por PayPal. No es un cambio del producto publicado.

El reloj financiero temporal de QA se usó para abrir dos ciclos futuros y se corrigió para avanzar con el tiempo transcurrido durante la recuperación. El reloj de Auth permaneció real. Por estos cambios de instrumentación e intervenciones, el tiempo total del ensayo no debe usarse como una medición de rendimiento de Vercel.

## Estado al cerrar

Las puertas QA quedaron apagadas; se retiró el webhook temporal y se cerró el receptor. Se restauraron las funciones financieras, sus permisos y valores por defecto, y se eliminó toda referencia funcional al reloj temporal. Se conservan historiales, asientos, expedientes y el caso en revisión. Los datos con fechas futuras y controles del simulacro permanecen identificados como QA.

Producción conserva cero retiros, ambas puertas apagadas y las mismas huellas de transacciones y destinatarios. Las tres migraciones de este PR están instaladas en QA; siguen pendientes en producción. No se cambió `vercel.json` ni una variable de dinero de Production o Preview.

## Criterio para la siguiente aceptación

Repetir cincuenta con una muestra nueva y la instrumentación corregida, conservando intacto el caso retenido del ensayo anterior. La revisión previa del operador debe consultar directamente la evidencia de envíos ya aceptados; no debe reclamar snapshots nunca enviados solo para inspeccionarlos, porque eso consume su presupuesto de recuperación.

Mantener el receptor hasta recibir el aviso firmado, medir tiempo y trabajo efectivo por ronda, comprobar una reserva y confirmación por retiro y documentar cualquier pausa común. La capacidad cuenta también consultas y reintentos. Requiere después comprobar la programación en Vercel Pro antes de fijar una frecuencia. La carga de 1.000 sigue validada de forma virtual; no se certifica nativamente con esta muestra.

La autorización comercial escrita de PayPal y los extractos reales de PayPal y banco continúan pendientes. Este ensayo no los sustituye.
