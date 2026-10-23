# Vigilancia y recuperación de las revisiones

Los dos controles de dinero continúan apagados. Esta entrega no cambia el cron diario de Vercel ni compra Pro.

## Vigilante independiente

La función `finance-watchdog` vive en el proyecto Supabase QA, separado del servidor Vercel y de la base principal. Consulta una ruta privada de solo lectura cada cinco minutos. La ruta devuelve únicamente metadatos del calendario y los controles de ejecución, sin balances, destinatarios ni respuestas de PayPal.

El proyecto principal guarda `PAYOUT_HEALTH_TOKEN` y `WATCHDOG_TRIGGER_TOKEN` como secretos de servidor. QA guarda sus correspondientes secretos y una clave de correo Development dedicada. El disparador utiliza Vault; nunca se guarda el token en el texto del cron. No debe utilizarse CRON_SECRET para esta conexión.

El monitor avisa tras dos consultas consecutivas fallidas (aproximadamente diez minutos), al pasar las 07:10 de Honduras sin una revisión diaria confirmada, o si cambia el calendario esperado o se enciende un control de dinero. El vencimiento se calcula desde la activación y la última revisión programada terminada; una consulta posterior o una ronda manual no lo desplazan.

Conserva un aviso por episodio y una constancia de recuperación. Los reintentos usan la misma referencia de Resend; se detienen después de cinco intentos o 23 horas. «Aceptado» significa aceptado por Resend, sin certificar lectura. Inicialmente usa onboarding@resend.dev hacia el correo del administrador porque la clave Development pertenece a un espacio distinto del remitente comercial. Un fallo de Supabase que afecte también al vigilante, o del proveedor de correo, puede impedir el aviso. El panel muestra cuándo deja de consultar el propio monitor.

Instalar `ops/watchdog/supabase/migrations/` únicamente en el proyecto independiente. No mezclarlo con las migraciones principales. La función autentica su propio token; no expone datos de pagos ni puede iniciar envíos. Programación esperada: `*/5 * * * *`, nombre `finance-independent-watchdog`.

Los archivos conservan las versiones registradas por la instalación remota: recuperación principal `20261023031247`, vigilante QA `20261023030008` y cron QA `20261023031445`. El ensayo previo de recuperación en QA quedó registrado como `20261023030005`; su historial se conserva y no debe ejecutarse `db push` del proyecto principal contra esa base de ensayos. No se reescribe el historial de ninguno de los proyectos para igualarlos.

## Recuperación supervisada

El ingreso a una ronda de proveedor registra cobertura del protocolo. Antes de cada caso, se guarda su referencia y la ronda en un historial inmutable. Una ronda interrumpida conserva sus reservas.

En Expedientes de pagos, la opción «Reanudar tras revisión» aparece cuando expiró la ronda y todos los casos iniciados tienen evidencia suficiente: instrucción nunca enviada, o respuesta canónica conciliada coherente con el estado y, para una entrega, con su asiento. Los avisos pendientes, consultas incompletas, resultados inciertos y rondas antiguas sin cobertura conservan el bloqueo. Una transferencia ya aceptada y todavía pendiente puede conservar ese estado sin obligar a recrearla.

El administrador aporta comprobantes, causa y motivo, revisa el efecto y confirma. La base vuelve a comprobar el expediente y la referencia exacta de la ronda bajo el bloqueo contable. Repetir una decisión tras perder su acuse devuelve la misma decisión; una evidencia cambiada exige actualizar la vista. Solo se elimina la espera común de esa ronda: permanecen cooldown, fondos, bloqueos individuales, referencias y controles de ejecución.

La comprobación adicional de Codex para el 23 de octubre a las 07:15 de Honduras es de solo lectura y necesita equipo encendido y aplicación abierta. Es independiente del vigilante permanente.

## Verificación

`npm run test:payout-operational-recovery`, pruebas de interfaz móvil/escritorio, regresiones de revisión, incidencias y capacidad. Los ensayos virtuales no consultan proveedores. La entrega nativa a varios destinatarios Sandbox se documenta por separado y no debe marcarse aprobada hasta recibir los resultados reales de Sandbox.
