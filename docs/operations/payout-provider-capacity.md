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

La migración `20261021191647_payout_provider_capacity.sql` debe aplicarse antes de publicar el servidor ampliado. La preparación en QA es independiente de Production. No modificar retiros ni tablas de historial para eliminar una espera.

## Ensayos y siguiente aceptación

`npm run test:payout-capacity` prueba 1.000 creadores con capacidades de 25 y 50, pausas, lentitud, interrupciones, permisos y puertas cerradas. Usa la API y SQL vigentes en PostgreSQL temporal, con transporte y reloj ficticios. No mide la latencia de PayPal, Supabase alojado o Vercel.

Con respuestas ficticias rápidas, 25 casos necesitaron 40 rondas; 50 necesitaron 20. Separadas cinco minutos, son estimaciones de 200 y 100 minutos respectivamente, antes de incidencias. Una latencia emulada de 2,5 segundos por solicitud redujo la primera ronda de cincuenta a catorce; la siguiente completó los restantes sin duplicados.

La propuesta a validar es **hasta 50 casos cada cinco minutos durante la ventana de pago**, comenzando con un ensayo nativo controlado de 25 y después 50. Las cifras finales se elegirán según duración real, respuestas 429, confirmaciones y conciliación. La programación actual y las puertas siguen sin cambiar. Sandbox no sustituye autorización comercial ni prueba disponibilidad real de fondos.

`vercel-payouts-pro.example.json` prepara el horario propuesto sin sustituir el `vercel.json` publicado: cada cinco minutos del 26 a las 00:00 al final del día 1 de Honduras, y una revisión diaria fuera de ventana. Las expresiones usan UTC y separan las horas para conservar UTC−6, incluso en meses cortos. `npm run test:payout-pro-schedule` compara cada intervalo entre 2026 y 2028, incluido febrero bisiesto, contra el calendario financiero. El ejemplo conserva los demás horarios y la duración de 180 segundos; requiere Pro y aceptación nativa antes de publicarse.
