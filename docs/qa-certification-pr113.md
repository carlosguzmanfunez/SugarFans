# Fans Reserve · Certificación técnica QA de la PR #113

**Resultado: las pruebas críticas de esta fase están aprobadas. La PR sigue en borrador y sin fusionar. El lanzamiento comercial permanece NO-GO.**

Revisión: 26 de octubre de 2026, Honduras (las evidencias posteriores a las 18:00 tienen fecha UTC del 27).
Repositorio: carlosguzmanfunez/SugarFans. Rama revisada: `audit/supabase-least-privilege-20261026`.
Punto de partida: `e9d28caed627061d860c721365708ab5b5655bdd`; base main observada: `775620d500c5dda3ebc9665342ad880cadaa2f20`.

## Qué quedó resuelto

| Comprobación exigida | Resultado |
|---|---|
| Horarios de reservas | QA ya tiene las dos funciones, tres validaciones y el control que copia la zona del horario o del evento a cada reserva. Pruebas de Honduras, Madrid, verano/invierno, reservas históricas y zonas inválidas aprobadas. |
| Devoluciones excepcionales | Se conservó la revisión supervisada, los comprobantes, la detección de duplicados y las restricciones de acceso. QA recibió además la protección de referencias de pruebas archivadas que ya tenía producción. No se archivaron ni borraron registros en esta fase. |
| Permisos, Créditos y regalos | Aprobados en PostgreSQL local con transacciones confirmadas; también se hizo un recorrido financiero confirmado en la base QA. |
| Reservas, conciliación y devoluciones simuladas | Aprobadas, incluidas decisiones simultáneas y reintentos. |
| TypeScript y compilación | Ambos aprobados; la compilación conserva avisos de archivos grandes, sin errores. |
| Acceso auténtico a QA | Fan, creador y administrador iniciaron sesión con Supabase Auth. Se verificó también el servicio con clave JWT y con `sb_secret_`. |

## Un fallo real encontrado y corregido

La PR original comprobaba el rol del servicio leyendo únicamente una variable antigua de la conexión. Con solicitudes auténticas de QA, **ambos tipos de clave de servicio guardaban los errores API/correo como errores web**.

La migración nueva `20261027015737_prelaunch_verified_log_source.sql` usa `auth.role()`, que entiende también los datos verificados que PostgREST entrega en JSON. La prueba real posterior confirmó:

- Servicio JWT: API se conserva como API; correo como correo.
- Servicio `sb_secret_`: mismo resultado.
- Visitantes, fans y creadores: no pueden hacerse pasar por el servidor.
- No se ampliaron permisos de tablas privadas ni se usó una sesión de usuario falsificada.

Se corrigió además la preparación de las pruebas en Windows: finales de línea, salida nula y un esquema sintético de concurrencia que se estaba creando dos veces. El simulador local de Auth ahora entiende también los datos JSON del acceso real. La preparación de bases desechables exige un servidor local explícito y nombres con prefijo `fr_`.

## Pruebas automatizadas: 305 comprobaciones aprobadas en 18 suites

Los resultados repetidos durante las correcciones no se cuentan otra vez.

| Suite | Aprobadas |
|---|---:|
| `test:supabase-permissions` | 9 |
| `test:credits-ledger` | 4 |
| `test:errors-email-db` | 11 |
| `test:db` | 21 |
| `test:reserve-time-zones-db` | 8 |
| `test:time-zones` | 6 |
| Conciliación PostgreSQL | 34 |
| Costos de cobro PostgreSQL | 34 |
| `test:refunds-db` | 14 |
| `test:partial-refunds` | 37 |
| `test:refund-exceptions-db` | 15 |
| `test:monthly-costs` | 18 |
| Revisión de costo tras devolución | 19 |
| Conciliación API con proveedor simulado | 8 |
| Reglas y exportación de conciliación | 10 |
| `test:finance-ledger` | 32 |
| `test:finance-concurrency` | 15 |
| `test:qa-prelaunch-auth`, acceso real a QA | 10 |
| **Total** | **305** |

También aprobados: `typecheck`, comprobación del calendario previa a la compilación y `build`.

La suite histórica de concurrencia comprueba sus migraciones originales con sesiones PostgreSQL independientes; las suites actuales de devolución y conciliación aplican el conjunto completo de migraciones y también prueban confirmaciones concurrentes. No se presenta la suite histórica como una prueba completa del esquema actual.

## Ensayo adicional confirmado en Supabase QA

Se utilizaron exclusivamente tres cuentas ficticias `qa113-…@example.invalid`. La cuenta creadora se preparó como verificada solo en QA; esto no constituye una prueba de Didit ni una verificación de identidad real.

1. Compra simulada de 2.000 Créditos por USD 19,99. Repetir su confirmación conservó una sola compra.
2. Regalo de 500 Créditos: quedaron 1.500 en el fan y se registraron USD 3 para el creador, el 60% del regalo de USD 5.
3. Una llamada de mantenimiento de beneficios conservó ese saldo y ese regalo.
4. Devolución excepcional simulada de USD 4: se revisó y confirmó; quedaron 1.100 Créditos.
5. Devolución simulada de los USD 15,99 restantes: se revisó y confirmó; el fan terminó en cero y se revirtieron los USD 3 del creador.
6. Cada decisión se envió simultáneamente dos veces con la misma referencia. Se obtuvo una sola decisión y ningún descuento adicional.
7. Lectura posterior desde una solicitud independiente: ambas devoluciones constan aplicadas, saldo del fan cero y devengo del creador cero.
8. El libro conserva dos movimientos opuestos de USD 3: uno registra la ganancia y otro su reversión. Cada cuenta vuelve a cero. No se borró la venta para hacer coincidir el saldo.

Estas solicitudes terminaron y quedaron confirmadas en la base QA; no fueron pruebas abandonadas mediante ROLLBACK. Los comprobantes del proveedor fueron **ficticios**. No se enviaron solicitudes a PayPal ni se certificó aquí una firma PayPal nueva.

Evidencia local: `EVIDENCIA-QA.json`, `hosted-finance.json`, `hosted-auth-reproducible.log` y los registros de cada suite en la carpeta de esta certificación.

## Cambios aplicados únicamente a QA

Proyecto: `pcxblbctafwmijfcwgdd` — fansreserve-qa-payouts.

- `20261026070407_archived_finance_test_records`: estructura y protección de referencias archivadas; sin reinicio financiero.
- `20261026210000_reserve_time_zones`: funciones, columnas, validaciones y trigger de horarios.
- `20261027015737_prelaunch_verified_log_source`: corrección de clasificación del servicio.

La integración falló dos veces al aplicar DDL con “Invalid or expired requestState”. Tras comprobar que no se había aplicado, se utilizó el CLI autenticado, con el proyecto QA indicado expresamente, transacciones y registro de las migraciones realmente ejecutadas.

La comparación de funciones no encontró funciones de producción pendientes de incorporar a QA después de la alineación. Se mantienen diferencias deliberadas: las correcciones de permisos de esta PR, la nueva política de vencimientos, funciones auxiliares exclusivas de QA, URL de avisos desactivada y envío push desactivado para que QA no contacte producción.

## Lo que esta certificación no autoriza

- La PR #113 permanece en borrador, abierta y **sin fusionar**. No se publica producción.
- Producción `odugxvqwuvewsvifwmwb` se consultó únicamente para comparar definiciones y comprobar controles. Las seis migraciones nuevas de seguridad de esta PR no están allí.
- `execution_enabled=false` y `batch_handoff_enabled=false` tanto en QA como en la comprobación de lectura de producción.
- No se enviaron pagos, cobros, devoluciones, correos ni solicitudes PayPal reales. No se rediseñaron pantallas.

## Pendientes que siguen abiertos

1. Revisión y aprobación humana de la PR; esta tarea ordena expresamente no fusionarla.
2. Autorización comercial escrita de PayPal antes de habilitar dinero real.
3. Validación contable/legal del saldo de Créditos sin gastar y sus condiciones comerciales. Estas pruebas no sustituyen esa revisión.
4. Revisar por finalidad los avisos restantes de Supabase: funciones privilegiadas, extensión en public y protección de contraseñas filtradas. No se revocaron funciones en bloque. La ausencia de políticas en tablas financieras privadas puede ser intencional y debe analizarse junto con sus permisos.
5. Protección de reportes por IP/CDN y comprobación de los registros de Vercel que el análisis anterior no pudo consultar.
6. Una prueba nueva de firma y devolución nativas de PayPal Sandbox, si se exige para la aprobación final del proveedor. Esta fase acredita simulaciones y el acceso real a Supabase, no una entrega nueva de PayPal.

Referencias oficiales para los avisos: [funciones anónimas privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [funciones autenticadas privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Cómo repetir

PostgreSQL 17 local, Node y las dependencias del repositorio. Definir `PGHOST=127.0.0.1`, `PGPORT=55439`, `PGUSER=postgres` y añadir los binarios de PostgreSQL a PATH. No utilizar una conexión remota para las suites desechables.

Ejecutar las suites anteriores mediante sus comandos npm o sus archivos en e2e. Para concurrencia definir también `FANSRESERVE_PG_BIN` con la carpeta de binarios locales.

La prueba hospedada `test:qa-prelaunch-auth` requiere `FANSRESERVE_QA_AUTH_TEST=1`, la URL QA exacta y las variables documentadas al inicio de su archivo. Las claves y contraseñas se inyectan desde almacenamiento privado; nunca se incluyen en este reporte, en Git ni en la salida de las pruebas. Genera entradas de error de prueba y no inicia pagos.

**Conclusión:** las comprobaciones técnicas solicitadas para esta fase están aprobadas y respaldadas. El permiso para lanzar o fusionar no forma parte de este resultado.
