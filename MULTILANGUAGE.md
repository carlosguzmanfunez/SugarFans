# Sistema Multilenguaje - Fans Reserve

## Características Implementadas

### 1. Detección Automática de Idioma
El sistema detecta automáticamente el idioma del usuario basado en:
- **Preferencia del navegador**: Utiliza `navigator.language` para detectar el idioma del navegador
- **Persistencia**: Guarda la preferencia en `localStorage` para mantener la selección entre sesiones
- **Prioridad**: Si el usuario ya seleccionó un idioma, ese tiene prioridad sobre la detección automática

### 2. Idiomas Soportados
- 🇪🇸 **Español (es)** - Idioma por defecto
- 🇺🇸 **Inglés (en)** - English
- 🇧🇷 **Portugués (pt)** - Português
- 🇫🇷 **Francés (fr)** - Français
- 🇮🇹 **Italiano (it)** - Italiano

### 3. Componentes Traducidos
Las siguientes páginas y componentes están completamente traducidos:

#### Páginas Principales
- ✅ **Landing Page** - Página de inicio con hero, creadores destacados, categorías
- ✅ **Age Verification** - Verificación de edad obligatoria
- ✅ **Login** - Página de inicio de sesión
- ✅ **Register** - Registro en 3 pasos
- ✅ **Navbar** - Navegación principal
- ✅ **Footer** - Pie de página con enlaces

### 4. Selector de Idioma
Ubicación del selector:
- **Navbar**: Visible en todas las páginas con navegación
- **Páginas de Auth**: Login, Register y Age Verification tienen selector independiente
- **Diseño**: Dropdown con banderas y nombres de idiomas

## Arquitectura Técnica

### Contexto de Idioma
```typescript
// src/context/LanguageContext.tsx
- LanguageProvider: Proveedor de contexto React
- useLanguage: Hook para acceder a traducciones
- detectLanguage(): Función de detección automática
- translations: Objeto con todas las traducciones
```

### Estructura de Traducciones
```typescript
{
  'nav.explore': 'Explorar',
  'landing.hero.title1': 'Conecta con tus',
  'login.email': 'Correo electrónico',
  // ... más de 150 claves de traducción
}
```

### Uso en Componentes
```typescript
import { useLanguage } from '../context/LanguageContext';

const MyComponent = () => {
  const { t, language, setLanguage } = useLanguage();
  
  return (
    <button>{t('common.save')}</button>
  );
};
```

## Flujo de Detección Automática

1. **Primera visita**:
   - Sistema detecta `navigator.language`
   - Si es uno de los idiomas soportados, lo usa
   - Si no, usa español por defecto

2. **Visitas posteriores**:
   - Sistema verifica `localStorage.getItem('fansreserve_language')`
   - Si existe, usa ese idioma
   - Si no, vuelve a detectar del navegador

3. **Cambio manual**:
   - Usuario selecciona idioma del dropdown
   - Se guarda en `localStorage`
   - Se actualiza el atributo `lang` del HTML
   - Toda la interfaz se traduce instantáneamente

## Agregar Nuevos Idiomas

Para agregar un nuevo idioma (ejemplo: Alemán):

1. **Agregar al tipo Language**:
```typescript
export type Language = 'es' | 'en' | 'pt' | 'fr' | 'it' | 'de';
```

2. **Agregar traducciones**:
```typescript
const translations: Record<Language, Record<string, string>> = {
  // ... idiomas existentes
  de: {
    'nav.explore': 'Entdecken',
    'landing.hero.title1': 'Verbinde dich mit deinen',
    // ... todas las claves
  }
};
```

3. **Agregar al selector**:
```typescript
const languages: { code: Language; flag: string }[] = [
  // ... existentes
  { code: 'de', flag: '🇩🇪' },
];
```

4. **Agregar nombre**:
```typescript
export const languageNames: Record<Language, string> = {
  // ... existentes
  de: 'Deutsch',
};
```

## Próximas Mejoras

### Páginas Pendientes de Traducir
- ⏳ Explore (Explorar creadores)
- ⏳ CreatorProfile (Perfil de creador)
- ⏳ CreatorDashboard (Panel de creador)
- ⏳ AdminDashboard (Panel de administración)
- ⏳ Pricing (Precios)
- ⏳ Help (Centro de ayuda)
- ⏳ Policies (Políticas legales)
- ⏳ Settings (Configuración)
- ⏳ Profile (Perfil de usuario)

### Funcionalidades Adicionales
- [ ] Traducción de contenido generado por usuarios (descripciones de creadores)
- [ ] Traducción automática con API (Google Translate/DeepL)
- [ ] Soporte para RTL (árabe, hebreo)
- [ ] Formato de fechas y números localizado
- [ ] Monedas locales por región
- [ ] Timezone automático

## Testing

Para probar el sistema:

1. **Detección automática**:
   - Cambia el idioma de tu navegador
   - Recarga la página
   - Verifica que el idioma cambie

2. **Selección manual**:
   - Haz clic en el selector de idioma
   - Elige un idioma diferente
   - Verifica que toda la interfaz se traduzca
   - Recarga la página para confirmar persistencia

3. **Persistencia**:
   - Selecciona un idioma
   - Cierra el navegador
   - Abre nuevamente
   - Verifica que se mantenga tu selección

## Notas Importantes

- El sistema está diseñado para ser **escalable** y fácil de mantener
- Las traducciones están centralizadas en un solo archivo
- El selector de idioma es **accesible** y responsive
- La detección automática respeta las preferencias del usuario
- El sistema es **SEO-friendly** con el atributo `lang` en el HTML

## Soporte

Para preguntas o problemas con el sistema multilenguaje:
- Revisa la documentación en este archivo
- Consulta el código en `src/context/LanguageContext.tsx`
- Ver ejemplos de uso en las páginas ya traducidas
