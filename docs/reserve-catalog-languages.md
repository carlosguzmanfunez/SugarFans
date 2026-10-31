# Reserve: catálogo del piloto en cinco idiomas

La edición aprobada retira del catálogo la muestra «Acceso anticipado a mi próximo proyecto» y utiliza nombres y descripciones claros para las nueve ofertas restantes. La oferta retirada se conserva inactiva; no se eliminan reservas ni registros financieros.

«Platiquemos de lo que te interesa» aparece primero, con una estrella y la acción «Reserva tu plática». Cuando una oferta requiere aprobación, la acción sigue siendo una solicitud. El precio, la duración, la disponibilidad y el procedimiento de pago no cambian.

## Lectura de las descripciones

`src/content/reserveCatalog.ts` contiene las versiones editoriales en español, inglés, portugués, francés e italiano. El selector «Idioma de las descripciones» está disponible en Reserve y en la sección Reserve de cada perfil. La selección se conserva al navegar y recargar. Los nombres, las descripciones, las etiquetas de los tipos y los botones de las tarjetas usan el idioma seleccionado; la búsqueda también reconoce el nombre traducido.

El resto del sitio mantiene su configuración de idiomas. Este selector no anuncia que los formularios, las políticas o toda la aplicación estén traducidos. Las traducciones se aplican solo si el tipo, el título y la descripción coinciden con la edición aprobada. Un texto nuevo o modificado por un creador conserva su contenido original; nunca se sustituye por una descripción genérica de otro servicio.

Los textos describen conversaciones, proyectos, preguntas, clases, entrenamiento y actividades públicas con fotos. Se evitan palabras relativas a citas, intimidad o contenido sexual. El saludo con fotos no inventa un centro comercial, una fecha ni una dirección.

## Datos y protección de reservas

La migración `reserve_catalog_plain_language` selecciona las ofertas por creador, tipo y texto anterior exacto. No utiliza identificadores generados ni modifica el contenido de las reservas históricas. Conserva precios, fechas, reglas de aprobación, descuentos y ubicaciones. Los identificadores internos de los tipos no cambian.

Las dos ofertas presenciales antiguas siguen necesitando país y departamento o estado. Su nuevo nombre no las vuelve visibles ni permite reservarlas sin la confirmación de ciudad existente.

## Validación

- `npm run typecheck`
- `npm run test:reserve-catalog-ui`: aplicación real en modo offline, móvil y escritorio, cinco idiomas, búsqueda, detalles, persistencia, perfiles, botones y filtros por ciudad. Las ubicaciones completas que utiliza el ensayo son muestras desechables del navegador.
- `npm run test:reserve-city-db`: PostgreSQL local y desechable, con todas las migraciones y controles de asistencia.
- `npm run test:reserve-city-ui`: recorrido anterior de ubicación, reservas y controles del creador.

Los ensayos del navegador bloquean solicitudes externas y no ejecutan cobros ni envíos. La revisión de datos antes y después debe comprobar que las reservas históricas no cambiaron y que `execution_enabled` y `batch_handoff_enabled` continúan en `false`.
