# Revisión de navegación · 5 de noviembre de 2026

React Router pasa de 6.30.6 a 7.18.5, fijado en el archivo de dependencias y su registro. Se conservan BrowserRouter, Routes y los imports existentes mediante el paquete compatible react-router-dom. React 18 y Node 24 cumplen los requisitos de la actualización. No se cambian las rutas, roles, aspecto ni cálculos financieros.

La alerta GHSA-wrjc-x8rr-h8h6 cubre destinos con barras mezcladas que podían abrir una dirección externa inesperada. La prueba nueva ejercita el normalizador corregido y la protección real de regreso después del ingreso. La segunda alerta, GHSA-337j-9hxr-rhxg, afecta a hidratación del servidor; esta aplicación usa el modo declarativo en el navegador y no utiliza esa función. Aun así, la dependencia se actualiza a la versión corregida.

La auditoría completa detectó además dos paquetes de herramientas de desarrollo: Vite y source-map-js. Se actualizan a Vite 6.4.5 y source-map-js 1.2.2 sin cambiar de versión principal de Vite. No se ocultan avisos con excepciones de auditoría ni se usa una actualización forzada de todas las dependencias.

Validación: `test:navigation-security`, TypeScript, compilación y auditoría de dependencias. El recorrido visual de ingreso y navegación se comprueba en la versión local de pruebas; los ensayos financieros permanecen aislados.

Referencias oficiales:

- https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
- https://github.com/advisories/GHSA-337j-9hxr-rhxg
- https://reactrouter.com/7.18.5/upgrading/v6
- https://github.com/advisories/GHSA-587h-7wmj-h5pm
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q
