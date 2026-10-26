# Administración clara

Superficie de operación para una persona que administra Fans Reserve sin formación técnica. Conserva marca, tipografía, colores, reglas de reparto, accesos y controles de pagos. No hay migraciones ni permisos nuevos.

## Organización

- Inicio: asuntos pendientes y acceso opcional a cuentas y actividad del periodo.
- Personas: búsqueda, verificación de identidades, perfiles de la plataforma y cuentas especiales.
- Contenido: denuncias/solicitudes y revisión de fotos y videos.
- Dinero: panel de pagos a creadores, retiros/devoluciones y todos los movimientos.
- Estado del servicio: problemas de la página y costos/límites.

Se conservan las doce secciones anteriores. `?section=...` conserva la selección al recargar y admite atrás/adelante. Una sección desconocida vuelve al inicio. Los enlaces son navegación; las autorizaciones siguen en el servidor y en la ruta protegida.

## Prioridades y confianza

El inicio reúne identidades pendientes, denuncias pendientes, archivos pendientes y disputas abiertas. Una devolución ya registrada no se presenta automáticamente como una tarea pendiente. Los expedientes y problemas de pagos se consultan en su panel propio.

Los indicadores describen los registros de esta consulta, no certifican un inventario ilimitado. El registro de fallos de las últimas 24 horas es evidencia histórica; no se etiqueta como un problema todavía abierto sin confirmación. Los límites de servicios reutilizan los umbrales vigentes. Los cálculos de reserva para servicios se explican como planificación, sin separación real de fondos.

Los estados de carga, consulta fallida y consulta vacía son distintos. Un fallo no se transforma en cero ni habilita acciones sobre una lista antigua. Las consultas descartan respuestas antiguas, capturan errores y evitan actualizar componentes cerrados. Un fallo de contenido no bloquea el panel independiente de pagos ni el de problemas de la página.

## Ficha de personas

Resumen, movimientos, restricciones e historial en un diálogo con foco de teclado contenido, Escape y retorno al control anterior. Se conservan las consultas de usuarios y los permisos existentes. La búsqueda y los filtros trabajan sobre las personas cargadas, con páginas de 20; no se promete una búsqueda ilimitada en el servidor.

Los importes de compras/ventas se identifican como operaciones, no como saldo disponible. La ficha muestra hasta 30 compras/ventas y 30 envíos cargados; las consultas generales conservan acceso al resto de movimientos. No muestra documentos de otras personas ni altera al destinatario de un pago.

La cuenta propia, administradores y propietario son de consulta en esta ficha. Restringir o quitar una restricción exige motivo; no habilita el desbloqueo directo de retiros cuando el servidor exige un expediente con evidencia.

## Decisiones

Antes de aplicar restricciones, eliminar cuentas/perfiles, decidir identidad o contenido, atender denuncias, cambiar beneficios especiales o guardar planes, se muestra persona afectada, efecto y pasos posteriores. Revisar o cancelar no llama a la acción. La confirmación bloquea clics duplicados mientras espera respuesta y no reintenta automáticamente un resultado sin confirmar.

Se conservan los registros existentes de decisiones y las comprobaciones del servidor. No se inventa un historial de auditoría completo para operaciones que antes no lo tenían. No hay nuevos cobros, devoluciones ni envíos de PayPal en este cambio. Las confirmaciones de beneficios conservan los porcentajes y las validaciones actuales.

## Móvil y verificación

Áreas y subsecciones se ajustan en varias filas. Controles de al menos 44 px, foco visible, nombres/correos largos ajustados, listas de denuncias sin tabla ancha y ficha desplazable dentro de pantalla. Las tablas contables conservan desplazamiento dentro de su sección.

Pruebas con SDK ficticio: `node e2e/admin-workspace-data.mjs`. Estados de la pantalla de costos, con renderizado del componente real sin red: `node e2e/admin-infra-state.mjs`; mientras espera la medición muestra carga, y solo presenta falta de medición cuando la consulta terminó. Revisión visual con los componentes reales y sin proveedores: compilar y ejecutar `node e2e/admin-workspace-review.mjs`. Las restricciones y beneficios se verifican además con `e2e/admin-accounts.mjs` y `e2e/special-accounts.mjs` en Postgres desechable. Los datos ficticios no se añaden a la aplicación publicada.
