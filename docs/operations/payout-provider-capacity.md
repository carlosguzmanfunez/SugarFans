# Capacidad y tolerancia de proveedores

Investigación y preparación del 21 de octubre de 2026. El límite inicial de cinco casos era propio del programa, no un cupo de Vercel o PayPal. Esta ampliación prepara hasta cincuenta casos por ronda, sin activar pagos, contratar planes ni modificar el cron publicado.

## Referencias verificadas

- [PayPal Payouts](https://developer.paypal.com/api/payouts) publica una referencia de **400 solicitudes POST por minuto** y recomienda reutilizar autorizaciones y recibir avisos. La referencia cuenta solicitudes; no equivale a pagos entregados ni garantiza un cupo particular de cuenta.
- [SDK de Payouts](https://developer.paypal.com/sdk/payouts) documenta hasta **15.000 destinatarios en una solicitud**. Nuestra integración actual usa un destinatario por solicitud y valida el resultado individual. Adoptar una solicitud con múltiples destinatarios exige otro diseño de snapshots, recuperación y conciliación; esta entrega no declara implementado ese cambio.
- [Control de tráfico de PayPal](https://developer.paypal.com/api/rate-limiting/) aclara que los límites varían por API, entorno y circunstancias. Pide disminuir tráfico ante 429, respetar la espera y usar reintentos progresivos. Los límites efectivos de la cuenta deben medirse en Sandbox y confirmarse con soporte si corresponde.
- [Vercel Functions](https://vercel.com/docs/functions/limitations) documenta hasta **800 segundos** en Pro con Fluid Compute, con un máximo extendido en beta sujeto a condiciones. Nuestro endpoint continúa configurado en **180 segundos**, con un presupuesto interno de **120 segundos**; ampliar el plan no cambia automáticamente estos ajustes.
- [Programación de Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing) permite intervalos desde un minuto en Pro. [Entrega y concurrencia](https://vercel.com/docs/cron-jobs/manage-cron-jobs) explica que una ejecución puede faltar o duplicarse y que una ejecución fallida no se reintenta automáticamente. Conservamos la concesión y las referencias persistidas para retomar pendientes.

## Controles preparados

`PAYOUT_WORK_LIMIT` es una variable **solo del servidor**, entre 1 y 50, por defecto 5. No habilita el ejecutor ni puede cambiarse desde el navegador. Se ensayan 25 y 50 como propuestas. El límite cuenta casos de trabajo: nuevos envíos, consultas y eventos; no promete esa cantidad de entregas por ronda.

El ejecutor trabaja secuencialmente. Reutiliza la autorización dentro de la ronda hasta antes de su expiración. Separa sus solicitudes a PayPal al menos 500 ms y admite como máximo 120 por ronda, incluyendo autorización y consultas. Es un presupuesto propio, deliberadamente menor que la referencia publicada; no es una garantía del tráfico agregado de toda la cuenta, que también puede tener cobros y operaciones manuales.

Antes de iniciar otro caso se comprueba el tiempo restante. Si el proveedor va lento, el programa atiende menos casos y deja el resto pendiente. Se limita el tiempo de autorización y conexión a la base. Los importes, destinatarios y referencias de retiros ya preparados permanecen inmutables.

Ante 429, autenticación rechazada, error temporal o desconexión se detiene el tráfico de esa ronda. La espera indicada se registra en PostgreSQL por entorno; sin indicación se usa un minuto, aumentando progresivamente hasta una hora. Una espera del proveedor mayor se conserva y nunca se acorta por el límite de espera progresiva. El proceso no se queda dormido durante minutos: termina y la siguiente ronda consulta la espera persistida.

Se registra la entrada a la ronda antes de contactar al proveedor. Si el proceso se interrumpe o falla la escritura que confirma su cierre/pausa, las siguientes rondas quedan detenidas con una incidencia, conservando fondos y referencias. La revisión diaria mantiene un solo episodio y aviso. Un operador autorizado debe conciliar esos envíos, documentar el expediente y resolver exclusivamente el control de interrupción mediante administración confiable de la base; no se ofrece un botón para borrar esa protección ni se cambian las puertas de dinero. Una pausa temporal correctamente registrada se reanuda sola al vencer.

La respuesta de inicio también se valida: un HTTP 200 sin operación reconocida o sin el identificador válido de la ronda se devuelve como inicio no confirmado (HTTP 503), en lugar de presentarlo como éxito vacío. No se contacta a PayPal ni se inventa una referencia para cerrar una concesión desconocida. Si la base alcanzó a crearla, se conserva hasta su vencimiento normal. Una respuesta JSON truncada se rechaza; nunca se sustituye por un objeto vacío. La autorización final exige el booleano `true` exacto. `npm run test:payout-start-ack` reproduce catorce fallos de inicio o autorización, conserva concesiones y reservas, comprueba la espera y completa después un único envío y asiento de confirmación.

Las migraciones `20261021191647_payout_provider_capacity.sql` y después `20261021200143_payout_work_rotation.sql` deben aplicarse antes de publicar el servidor ampliado. Ambas están instaladas en QA independiente junto con la migración de espejos. No modificar retiros ni tablas de historial para eliminar una espera.

## Problemas individuales y pausas generales

Un creador sin verificar, bloqueado, con disputa o con un pago pendiente no detiene a los demás por sí solo. El envío afectado conserva su reserva y referencia. La revisión registra sus incidencias y los avisos; no se repite un pago aceptado para intentar desbloquearlo.

La selección guarda el último turno de cada caso realmente iniciado, antes de procesarlo. Atiende primero los casos todavía no intentados y después los que llevan más tiempo esperando. Así, varios pendientes antiguos o errores de preparación no vuelven a ocupar todos los primeros lugares indefinidamente. Los casos no alcanzados por tiempo conservan su turno; este registro no modifica saldos ni prueba una entrega.

Se conserva una pausa general si PayPal exige esperar, falla su acceso o conexión, o la ronda no puede confirmar la escritura de su cierre. También siguen los controles comunes de fondos, conciliación, autorización y plazo. Una ronda limitada puede terminar sin haber atendido todos sus casos; la siguiente retoma la lista. No se borran esos controles para acelerar un pago individual.

`npm run test:payout-isolation` reproduce la diferencia con 12 creadores: uno bloqueado deja cobrar a los otros once; uno pendiente permite cuatro pagos sanos en la misma ronda; cinco pendientes dejan avanzar a otros siete sin reenviar lo aceptado; cinco fallos de preparación después del cierre ya no acaparan las rondas. Corregida la causa, sus cinco casos pueden completarse con las reservas originales. Incluye permisos de la tabla privada y de la función de turnos. Toda la prueba intercepta la red y usa datos ficticios.

## Ensayos y siguiente aceptación

`npm run test:payout-capacity` prueba 1.000 creadores con capacidades de 25 y 50, pausas, lentitud, interrupciones, permisos y puertas cerradas. Usa la API y SQL vigentes en PostgreSQL temporal, con transporte y reloj ficticios. No mide la latencia de PayPal, Supabase alojado o Vercel.

Con respuestas ficticias rápidas, 25 casos necesitaron 40 rondas; 50 necesitaron 20. Separadas cinco minutos, son estimaciones de 200 y 100 minutos respectivamente, antes de incidencias. Una latencia emulada de 2,5 segundos por solicitud redujo la primera ronda de cincuenta a catorce; la siguiente completó los restantes sin duplicados.

La propuesta a validar es **hasta 50 casos cada cinco minutos durante la ventana de pago**. El [ensayo nativo de 25 y después 50](payout-native-acceptance.md) confirmó 74 retiros, recibió avisos firmados y conservó uno en revisión después de consumir su recuperación durante la instrumentación. No permite aprobar todavía cincuenta sin intervención ni medir Vercel. Las cifras finales se elegirán tras repetir esa aceptación con la instrumentación corregida. La programación actual y las puertas siguen sin cambiar. Sandbox no sustituye autorización comercial ni prueba disponibilidad real de fondos.

`vercel-payouts-pro.example.json` prepara el horario propuesto sin sustituir el `vercel.json` publicado: cada cinco minutos del 26 a las 00:00 al final del día 1 de Honduras, y una revisión diaria fuera de ventana. Las expresiones usan UTC y separan las horas para conservar UTC−6, incluso en meses cortos. `npm run test:payout-pro-schedule` compara cada intervalo entre 2026 y 2028, incluido febrero bisiesto, contra el calendario financiero. El ejemplo conserva los demás horarios y la duración de 180 segundos; requiere Pro y aceptación nativa antes de publicarse.
