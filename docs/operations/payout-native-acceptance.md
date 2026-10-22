# Aceptación con Supabase QA y PayPal Sandbox

22 de octubre de 2026. Aceptación técnica del ensayo aislado; ejecución con dinero real deshabilitada.

## Resultado actual

| Comprobación | Resultado |
| --- | --- |
| Creadores ficticios de esta muestra | 1.000 |
| Entregas nativas Sandbox confirmadas | 1.000 de USD 49; USD 49.000 ficticios |
| Grupos internos | 20 de 50; espejo pendiente vacío al cierre |
| Referencias de lote e ítem únicas | 1.000 de cada una |
| Confirmaciones contables | Una por retiro; ninguna liberación anticipada |
| Avisos individuales de éxito | 1.000 conciliados |
| Comprobaciones de firma satisfactorias | 3165 |
| Comisión de retiro estimada / informada | USD 1.000 / USD 980 |
| Ajustes de devolución de costos | 1.000 de USD 0,02; USD 20 en total |

La muestra utilizó una sola cuenta receptora Personal Sandbox verificada. No representa 1.000 cuentas PayPal diferentes ni una petición multidestinatario: el sistema actual envía una solicitud individual por creador. Las ganancias, identidades y fondos eran ficticios. El código funcional probado corresponde a 4f4ea73, con instrumentación y controles temporales de QA fuera del repositorio.

## Programación e interrupción completa

Se habilitaron etapas de 1, 50, 100, 250 y 1.000. Supabase QA programó llamadas a Vercel QA cada dos minutos. La configuración admitía hasta 50 casos de trabajo por ronda, sin prometer 50 entregas; consultas y reintentos también consumen casos y presupuesto de tiempo. No se invocaron rondas manualmente para acelerar la prueba. El reloj financiero temporal avanzaba desde abril de 2027; Auth y la ejecución usaron tiempo real.

En el primer envío se ejecutó process.exit(97) después del HTTP 201 nativo y antes de guardar la aceptación. Vercel registró la muerte del proceso y HTTP 500. El snapshot quedó incierto y reservado. Una ronda posterior detectó PROVIDER_INTERRUPTED y no realizó solicitudes al proveedor.

Tras vencer la concesión se recuperó ese retiro con payout-check y la misma referencia y payload. PayPal devolvió USER_BUSINESS_ERROR con el enlace al lote original. Quedaron dos intentos POST de la misma referencia, un solo pago y una sola confirmación contable, sin liberación. La revisión se documentó mediante el procedimiento de expedientes antes de levantar exclusivamente el active_run de esa interrupción mediante administración confiable. Las otras puertas y esperas se conservaron. Esto prueba recuperación con operador; no certifica reanudación completamente desatendida tras una caída total.

También se observaron pausas temporales de conexión durante el ensayo. Se respetó la espera registrada y las rondas continuaron al vencerla. No se borraron controles para hacer pasar la muestra. La evidencia distingue esta espera del cierre forzado inicial; no atribuye a PayPal una respuesta HTTP que no se haya observado.

## Comisiones e integridad

Las comisiones se normalizaron desde evidencia individual nativa Sandbox y se resolvieron mediante finance_fee_preview y finance_fee_resolve con el administrador QA. Las importaciones se dividieron en cinco bloques de 200 filas. Repetir cada decisión con la misma clave devolvió su resolución original. Los ajustes de USD 20 no cambiaron retiros, snapshots, comprobantes ni la comisión comercial de Fans Reserve. El libro conserva débitos y créditos iguales.

Antes de esta tanda también se resolvieron los USD 0,90 de la muestra anterior de 45 entregas, mediante 45 ajustes de USD 0,02. Estos datos de prueba no constituyen extractos reales de PayPal o banco ni una tarifa comercial confirmada.

Los 224 retiros anteriores, sus envíos y los 1.394 asientos que existían al comenzar esta tanda conservaron sus huellas. El retiro QA antiguo en revisión manual conserva su reserva, sus cinco intentos y la ausencia de lote conocido; no fue reiniciado ni marcado como pagado. Los expedientes individuales anteriores protegidos no fueron reescritos. La incidencia compartida de interrupción sí recibió el seguimiento documentado de esta nueva prueba. Dos consultas históricas de webhook quedaron sin respuesta y se conservan así; consultas posteriores de secuencia mayor confirmaron ambos pagos con su lote nativo. No se fabricaron respuestas para cerrar los registros incompletos. También se observó un reintento automático de otro envío con el mismo payload y referencia; terminó en una sola entrega.

## Correo y cierre

La clave existente de Preview permitió enviar desde noreply@fansreserve.com al administrador. El reintento de la misma solicitud devolvió un único identificador de correo. Se retiró el despliegue temporal de comprobación sin extraer claves ni cambiar variables de Production o Preview. La clave distinta de Development y la recuperación del acceso administrativo al espacio original de Resend son asuntos separados.

Se retiraron el cron y el webhook propios del ensayo, se apagaron ejecución y handoff, y se restauraron las funciones financieras, ACL, valores por defecto y reloj de QA. La evidencia cifrada se verificó tras volver a leerla. Los historiales financieros permanecen conservados. La publicación de estas mejoras no habilita dinero real ni cambia el cron comercial.

## Publicación y alcance pendiente

Las cuatro migraciones de este PR se aplicaron a producción antes de publicar el servidor, conservando las huellas financieras y ambas puertas apagadas. El registro de migraciones mantiene las versiones canónicas del repositorio. No se contrató otro plan de Vercel. El horario propuesto para Pro sigue siendo un ejemplo; esta prueba verificó Supabase QA → Vercel QA, no un cron comercial de Vercel Pro.

Siguen pendientes la autorización escrita de PayPal para el modelo de intermediación, sus tarifas efectivas y la conciliación con extractos reales. El acceso a un producto Sandbox y esta aceptación técnica no sustituyen esos requisitos.

El [informe anterior del 21 de octubre](payout-native-acceptance-20261021.md) conserva el historial de la muestra de 74 entregas y un retiro retenido. El reporte y los archivos del ensayo posterior se mantienen fuera de Git, en outputs/cierre-pagos-2026-10-22/ del espacio de trabajo. Las credenciales no forman parte del PR.
