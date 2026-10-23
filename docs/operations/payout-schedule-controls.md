# Programación y supervisión de las revisiones

22 de octubre de 2026. La programación descrita aquí solicita **revisión**, nunca ejecución de pagos nuevos. No cambia las comisiones, reservas ni autorizaciones comerciales.

## Horario y plan comprobados

El equipo propietario de fans-reserve estaba en Vercel Hobby al consultar su API. La configuración publicada conserva una revisión diaria a las 12:00 UTC, aproximadamente entre las 06:00 y las 07:00 de Honduras. `/api/usage` conserva su horario independiente.

El perfil preparado para Pro revisa cada cinco minutos desde el 26 a las 00:00 hasta el final del día 1, en UTC−6. Fuera de esa ventana revisa una vez al día a las 06:00. No implica una promesa de entrega dentro de cinco minutos. El ciclo de ganancias permanece desde el 26 a las 00:00 hasta antes del siguiente 26.

Cada revisión programada o manual admite hasta 50 casos y conserva el presupuesto de tiempo existente, la rotación de pendientes, la concesión de tres minutos y las pausas del proveedor. Consultar un evento o un retiro también consume un caso; no son necesariamente cincuenta pagos. Los avisos siguen limitados a tres por ronda y mantienen sus reintentos e idempotencia existentes.

## Separación del envío de dinero

Los dos perfiles llaman exclusivamente a `/api/payout-review`, que autentica CRON_SECRET y llama al ejecutor existente con `executeRequested=false`. Ni parámetros de consulta ni las opciones antiguas de ejecución convierten esta ruta en una solicitud de envío. Sí puede consultar y conciliar entregas ya identificadas, usando las referencias y reservas existentes. La ruta anterior se conserva por compatibilidad, pero no aparece en los horarios.

`src/config/payout-schedule.json` define el perfil publicado y el límite. El build comprueba que coincida con vercel.json y que el ejemplo Pro siga alineado. Los perfiles no habilitan ninguna puerta de dinero ni cambian PAYOUT_AUTOMATION_MODE. Habilitar envíos necesitará una publicación separada, autorización escrita de PayPal y los demás controles comerciales.

## Qué muestra el panel

El horario se consulta por una operación autenticada del servidor, solo para administradores, sin iniciar una revisión ni registrar movimientos. El panel distingue configuración publicada de ejecución observada. Una revisión manual no prueba que el cron funcione: los resúmenes nuevos guardan trigger y schedule_profile.

Los indicadores detectan falta de confirmación, una revisión tardía, una ronda sin terminar durante más de tres minutos y el último intento fallido. Para Hobby se respeta su margen horario; se añaden diez minutos de tolerancia operativa. Se usa la hora del servidor recibida y el tiempo transcurrido, no la zona horaria del teléfono.

La consulta financiera existente conserva un historial reciente acotado. Si ya no contiene una ronda programada del perfil actual, la pantalla informa que falta confirmación; no inventa una fecha. El panel detecta atrasos al consultarlo: no sustituye un monitor externo ni puede enviar correo si el servicio completo está caído.

## Atención operativa

1. Comprobar la última ronda, el espejo y el expediente antes de repetir una operación. Un fallo individual no exige detener creadores sanos; fondos, proveedor y conciliación pueden imponer pausas comunes.
2. Ante fondos insuficientes, confirmar saldo disponible en PayPal y registrar evidencia nueva posterior al rechazo. La comprobación vence a las 24 horas y no detecta todos los gastos externos posteriores.
3. Ante una respuesta incierta, consultar la referencia original. No crear otro retiro, cambiar destinatario, liberar reservas ni marcar pagado para desbloquear la cola.
4. Ante caída completa, identificar la ronda original, confirmar con PayPal el estado de todos sus envíos inciertos y guardar la revisión en el expediente. El responsable técnico puede levantar únicamente el control de interrupción de esa ronda, mediante administración confiable y comparación de su referencia actual. Conservar las demás puertas, pausas, presupuestos y reservas. Una ejecución ajena o más reciente nunca se elimina.
5. Ante un aviso agotado, comprobar su entrega y documentar la atención del expediente antes de cualquier nuevo intento. La pantalla no añade un botón para saltar estos controles.

La recuperación de caída completa demostrada en Sandbox necesitó operador. Este cambio mejora su seguimiento y guía; no introduce recuperación desatendida ni un botón que borre la pausa.

## Preparar Pro sin contratarlo

`npm run payout:schedule:check` comprueba la configuración sin acceder a credenciales ni a proveedores. El ejemplo completo sigue en `vercel-payouts-pro.example.json`.

Una vez que Carlos haya autorizado y contratado Pro, `npm run payout:schedule:prepare-pro` consulta el plan del equipo vinculado mediante Vercel CLI y modifica **solo dos archivos locales**: el perfil y vercel.json. Si el plan sigue en Hobby o no puede confirmarse, falla antes de escribir. No compra planes, publica ni habilita pagos. Revisar el diff, repetir las pruebas y publicar después. En Windows puede indicarse el archivo de Vercel CLI con VERCEL_CLI_JS cuando no esté instalado globalmente en su ubicación habitual.

Incluso con Pro, este perfil seguirá siendo de revisión: no habilita el calendario comercial de envíos. La capacidad nativa previa de 1.000 entregas Sandbox, con un mismo receptor, es evidencia técnica separada de esta programación.

## Validación

- Typecheck y build; verificación de consistencia antes de cada build.
- Carga en frío de módulos ESM emitidos sin bundle, como en Node: importación JSON con atributo de tipo y extensión explícita en el calendario compartido. Comprueba que las rutas arrancan y rechazan acceso anónimo sin red.
- test:payout-schedule: todos los intervalos de cinco minutos de 2026–2028, incluidos meses cortos, cambios de año y febrero bisiesto; control del plan, permisos, separación manual/programado y ausencia de envíos con las opciones antiguas activadas.
- test:payout-schedule-ui y test:payout-operations-ui: móvil/escritorio, teclado, estados de atraso y caída, lectura sin escrituras y operaciones existentes.
- Regresiones de inicio incierto, automatización, aislamiento y avisos. Toda nueva prueba financiera intercepta la red y usa datos ficticios.

Fuentes: [Vercel Cron: uso y planes](https://vercel.com/docs/cron-jobs/usage-and-pricing), [concurrencia, idempotencia y fallos de cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs). Los crons consumen recursos de Functions; Pro no garantiza una factura plana ni tiempos de entrega de PayPal.
