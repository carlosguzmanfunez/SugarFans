# Propietario y retirada de accesos demo (F01)

La autoridad de propietario reside en un registro privado con una sola fila, asignado por mantenimiento a una identidad de Auth confirmada. El correo y el ID del titular se resuelven fuera del código versionado. Ni el email introducido en el navegador ni user_metadata conceden permisos.

El propietario conserva su perfil y rol de negocio original. El selector Fan/Creador/Administrador cambia únicamente su vista privada: no retira su perfil de creador de Explorar, no mueve sus publicaciones, reservas, saldos ni destinatarios y no crea identidades o contraseñas compartidas. El panel está en /owner y se abre desde el menú de cuenta → Dirección general. Cambiar de vista mantiene la autoridad administrativa; no sirve para certificar los límites de un usuario ordinario, que requieren una cuenta de prueba separada.

owner_access y owner_switch_view se conceden exclusivamente a authenticated. Ambos comprueban el registro privado, Auth confirmado/no bloqueado, suspensión y la existencia de la sesión firmada session_id en auth.sessions. La autorización se reevalúa también al consultar is_admin. Revocar esa sesión retira la autoridad del propietario incluso antes de que expire su JWT. El historial de vistas es inmutable, y repetir la vista actual no genera otra entrada.

Los propietarios están protegidos frente a suspensión, eliminación o cambios desde la gestión común de cuentas. Los controles de identidad, mínimo, disputas, fondos y confirmación del proveedor de los pagos conservan sus reglas. El selector no activa el ejecutor de lotes ni carga fondos ficticios.

Las tres antiguas identidades compartidas quedan bloqueadas durante 100 años, sin contraseña reutilizable ni sesiones/tokens de refresco; Demo Admin pierde el rol admin. Se conservan las filas de Auth/perfiles y su historia relacionada. El RPC de administración rechaza volver a promover una identidad demo. Los accesos demo y su contraseña se incluyen únicamente en un build offline sin conexión a Supabase. Un build publicado sin configuración Auth falla cerrado.

## Orden de publicación

1. Confirmar la identidad personal indicada por el titular y su estado. Capturar firmas de transacciones, cuentas, retiros, saldos y del perfil personal; revisar actividad disponible de la antigua cuenta.
2. Aplicar 20261020174153_owner_account_controls.sql.
3. En una transacción de mantenimiento, resolver el email confirmado, comprobar que hay una sola identidad habilitada y registrar exclusivamente su UUID en security_private.owner_account con motivo. No editar el rol ni el perfil del titular. No reutilizar una identidad demo.
4. Verificar owner_access/is_admin bajo authenticated con el sub y session_id de una sesión vigente, sin emitir ni extraer JWT.
5. Aplicar 20261020174155_retire_shared_demo_identities.sql. Su precondición impide retirar al único administrador si no existe otro administrador confirmado o el propietario habilitado.
6. Verificar el bloqueo de las tres demos, sesiones/tokens a cero, ausencia del rol administrativo demo y conservación del perfil e historia financiera del titular. Revisar permisos, cuerpos y asesores.
7. Publicar cliente/servidor y comprobar /owner, producción y ausencia de contraseña demo en los JS nuevos.

No restaurar la contraseña, el rol o las sesiones demo como rollback. Una reversión de frontend conserva la autoridad y la contención en la base. El titular mantiene su inicio de sesión personal; no se comparte una contraseña por chat ni se crea otro usuario duplicado.

## Pruebas

- npm run test:demo-security-db: permisos, contención, sesiones, singleton, auditoría, vistas, publicación administrativa y conservación de historia en PostgreSQL temporal.
- npm run test:demo-security-ui: builds producción/offline, contraseña excluida, entrada manual demo rechazada antes de Auth, login personal simulado y demo local.
- npm run test:owner-ui después de npm run build: OwnerPanel, AuthProvider y adaptador Supabase reales contra RPC SQL temporales; tres vistas, usuario sin privilegios, 1440/390 px y perfil creador conservado. Autenticación y red externa simuladas.
- npm run test:admin-accounts con PostgreSQL local: regresiones administrativas con todas las migraciones. El arnés usa transacciones por migración y el sumidero NUL de Windows.
- Las pruebas de concurrencia de pagos se documentan por separado. No se afirma haber certificado PayPal Sandbox ni producción con estas pruebas.
