# Habilidades de Claude Code

Claude Code carga automáticamente las habilidades de esta carpeta.

| Habilidad | Origen | Licencia |
|---|---|---|
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `plugin/skills/impeccable` (v4.5.0, commit 508d7e8) | Apache 2.0 |
| `emil-design-eng` (principal), `animate`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `pick-ui-library`, `prototype`, `mobile-native`, `break-ui`, `ask-sonner` | [emilkowalski/skills](https://github.com/emilkowalski/skills) (commit e8a175d) | MIT |
| `design-taste-frontend` (Taste Skill v2, la opción por defecto) | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` (commit ce26fc2) | MIT |

Copiadas sin modificar. De Emil Kowalski se omitieron `write-swift` y `animate-expo` (solo para apps nativas iOS/Expo). De Impeccable no se instalaron sus hooks opcionales. De Taste Skill solo se instaló la habilidad principal, no sus variantes de estilo (brutalist, minimalist, soft, etc.).

Para actualizar, vuelve a copiar las carpetas desde los repositorios de origen.
