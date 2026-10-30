# Fotos y videos: reducir descargas sin contratar Pro

Implementación comprobada con ensayos internos. No requiere migraciones, cambios de plan ni modificaciones de los archivos subidos.

## Comportamiento

- Las fotos de las publicaciones y las imágenes de `CoverImage` reciben su URL cuando están a menos de 200 píxeles de la pantalla. Se conserva un espacio inicial para las fotos de publicaciones; al cargar, usan sus dimensiones originales.
- La aplicación conserva el mismo archivo y la misma URL. No comprime, recorta, convierte ni reduce la resolución del archivo.
- Las publicaciones y la galería muestran una portada decorativa local para los videos. Esa portada no representa un fotograma real: evita descargar el video para obtenerlo.
- El visor y los videos personalizados entregados esperan una pulsación en «Reproducir video». Solo entonces se crea el reproductor con la fuente original.
- Cambiar de publicación, cerrar el visor o retirar el acceso desmonta el reproductor; su limpieza lo pausa, retira la fuente y cancela su carga. Cambiar la URL exige pulsar de nuevo.
- La navegación por teclado, las flechas y el gesto de desplazamiento del visor siguen disponibles.
- Si el navegador no soporta `IntersectionObserver`, las fotos conservan la carga nativa del navegador como alternativa.

Este cambio abarca las publicaciones, la galería, el visor y los beneficios antiguos de videos personalizados. Las vistas previas del formulario de subida, el panel de gestión del autor y los videos promocionales mantienen su comportamiento anterior.

## Acceso y conservación de copias

Los archivos privados siguen privados. No hay una memoria compartida de enlaces de pago, ni cambios de las reglas del servidor, ni ampliación de su vencimiento. `createSignedUrls` sigue comprobando los permisos en Storage en cada consulta.

Las fotos públicas de perfil ya reciben un nombre nuevo al reemplazarlas. Se conserva ese comportamiento y la configuración actual de conservación de copias. El ensayo HTTP local comprueba que una URL pública estable se puede reutilizar con un encabezado de una hora y que una URL nueva carga el reemplazo; no mide el encabezado ni la factura actuales del proyecto remoto.

Supabase activa Smart CDN automáticamente en Pro o superior. No hay que activar una opción adicional en estos componentes al cambiar de plan. Antes de optimizar los enlaces privados deberá revisarse la autorización vigente: un enlace firmado es una credencial de acceso y una copia CDN puede persistir después del vencimiento del token. Nunca convertir contenido exclusivo en público para aumentar el aprovechamiento de copias.

## Comprobaciones

```sh
npm run typecheck
npm run test:media-delivery
npm run build
```

`test:media-delivery` crea una compilación offline, prueba los componentes con archivos locales y abre la aplicación offline para publicar como creador y consultar como fan. No requiere Supabase, PayPal, Vercel ni credenciales. Bloquea solicitudes externas en el recorrido de la aplicación.

Opciones del ensayo:

- `MEDIA_DELIVERY_OUTPUT`: carpeta de resultados y capturas. Por defecto usa la carpeta temporal del equipo.
- `MEDIA_DELIVERY_BASELINE_REF`: referencia Git opcional para comparar el `PostCard` anterior real. La comprobación inicial usó `aee7a90`, sin modificar esa revisión.

En Chromium, tanto a 1366×900 como a 390×844, una lista de 20 fotos solicitó dos al inicio frente a 20 antes del cambio. Una lista de 20 videos pasó de 20 solicitudes para vistas previas a cero antes de reproducir. La foto número 20 se cargó al alcanzarla. Se comprobó reproducción real, limpieza del reproductor, selección de otro video, acceso cerrado, reutilización de una foto pública y funcionamiento sin `IntersectionObserver`.

Estos resultados no significan un 90% de ahorro en toda la factura: quien recorra las 20 fotos seguirá descargando las 20. Tampoco certifican Safari, una CDN real, todos los permisos de la base ni toda la aplicación.

La revisión posterior corrigió el bloqueo real de `PlatformSync`: al terminar de comprobar renovaciones se recargaba el catálogo, su indicador de carga cambiaba y la misma comprobación se iniciaba otra vez. Ahora cada combinación de usuario y suscripciones se comprueba una sola vez; una respuesta de un estado anterior no vuelve a refrescar un conjunto diferente de suscripciones.

También se actualizaron las expectativas de Ayuda, la prioridad de zona horaria al elegir país, los menús administrativos, las confirmaciones y la selección de elementos repetidos en historiales. Se preservan las decisiones y las confirmaciones del producto. La batería histórica revisada completó **212/212 recorridos**; la regresión específica comprueba un solo cargo offline y navegación normal después de suscribirse.

El ejecutor usa la API de Vite compatible con Windows y rutas `fileURLToPath`. Solo acepta servidores HTTP locales, comprueba que se trata de la aplicación offline y bloquea las solicitudes externas. Guarda el resultado de cada comprobación, distingue una ejecución incompleta de una aprobada y corta un paso atascado a los 30 segundos. Los errores inesperados de consola también impiden aprobar la ejecución. `E2E_RESULTS_DIR` elige la carpeta de evidencias; `E2E_FAIL_FAST=1` permite detener un diagnóstico en el primer fallo sin declararlo aprobado.

## Al disponer de Pro

1. Medir los bytes entregados y el aprovechamiento de copias en el proyecto real.
2. Comparar perfiles equivalentes y reproducciones completas, separando fotos públicas y contenido de pago.
3. Revisar cambios de foto, eliminación, moderación, cierre de sesión y fin de suscripción antes de ampliar cualquier conservación de copias.
4. Calcular el gasto con las entregas efectivamente registradas. No prometer que todas usarán la tarifa reducida.

Fuentes consultadas el 29 de octubre de 2026:

- [Supabase Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)
- [Supabase: métricas de copias](https://supabase.com/docs/guides/storage/cdn/metrics)
- [Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
