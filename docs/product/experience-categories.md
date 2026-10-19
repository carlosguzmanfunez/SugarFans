# Categorías de experiencias

La categoría principal del creador describe su perfil. Cada experiencia puede tener otra categoría, guardada como `details.categoryId` en `vip_experiences`. Elegirla en el asistente solo modifica el borrador; cancelar no guarda cambios en el perfil ni en otras experiencias.

El asistente usa la categoría del perfil como valor inicial al crear una experiencia. Al editar una experiencia etiquetada, recupera la categoría de esa experiencia. Los tipos, modalidades y ubicaciones permitidos dependen de esa selección. Las tarjetas muestran la etiqueta y el filtro de Reserve utiliza la categoría de la experiencia.

Las experiencias anteriores sin etiqueta conservan el comportamiento de respaldo a la categoría del perfil. Esta entrega no reescribe perfiles ni experiencias históricas. Al editar y guardar una experiencia anterior, el asistente añade su categoría explícita.

## Despliegue

1. Revisar y aplicar `supabase/migrations/20261019055501_reserve_experience_category.sql` al proyecto de Fans Reserve.
2. Después, desplegar el cliente de esta rama.

La migración prepara las reglas de categoría/tipo y ajusta los triggers de experiencias y reservas a domicilio para usar la categoría de la experiencia. Los textos de moderación, la aprobación manual para domicilios y las restricciones de Tu gente se conservan. Las solicitudes personalizadas sin una experiencia publicada continúan usando la categoría del perfil. Las etiquetas introducidas por un fan o las etiquetas antiguas no válidas no cambian esas reglas.

No se crean tablas ni se conceden nuevos permisos de RPC. El helper nuevo es interno; los triggers conservan su contexto y sus permisos restringidos. La migración es compatible con el cliente anterior, que no envía `categoryId`, y puede permanecer instalada si se revierte solo el cliente.

## Verificación

- `npm run typecheck`
- `npm run test:experience-category-db`: PostgreSQL local en memoria, sin red ni credenciales; comprueba conservación de perfiles/experiencias, etiquetas inválidas, límites de categorías, reservas a domicilio, permisos y correspondencia del catálogo entre servidor y cliente.
- `npm run e2e`: casos de cancelar una categoría, publicar Fitness desde Tu gente, volver a editar sin perder la etiqueta, recuperar la categoría principal en otro borrador y filtrar Reserve por la experiencia. Incluye comprobación de ancho en móvil.

Las pruebas E2E usan el modo `offline` y sus cuentas de demostración. Las comprobaciones de esta entrega no crean experiencias ni modifican perfiles en producción.
