# Reinicio de registros de prueba

El 26 de octubre de 2026 el propietario confirmó que los cobros de USD 14,99, USD 7,99 y USD 249,99, el regalo de USD 200, las suscripciones y los saldos anteriores eran pruebas sin dinero real. También pidió reiniciar los Créditos de fans y las ganancias de creadores, conservando usuarios, perfiles y contenido.

La migración `20261026070407_archived_finance_test_records.sql` crea exclusivamente el archivo privado y la protección contra avisos antiguos. No borra ni reinicia datos cuando se instala.

La operación supervisada utiliza `scripts/finance-test-reset.mjs` para generar una transacción con dieciséis tablas enumeradas. Primero se inventarían los registros y se verifica un respaldo cifrado fuera del repositorio; después la transacción comprueba de nuevo los importes, cantidades y huellas. Aborta si llegaron movimientos nuevos, hay pagos o lotes, existen avisos pendientes o algún control de envíos está activo.

Los registros completos se conservan en un archivo privado e inmutable. Solo entonces se vacían las tablas enumeradas con `RESTRICT`, sin `CASCADE` y sin desactivar protecciones. Los identificadores anteriores quedan reservados: un aviso de una captura o suscripción archivada se conserva como atendido y no vuelve a producir Créditos o ganancias. Una referencia nueva mantiene el procedimiento normal y un ID de aviso contradictorio mantiene su revisión.

No se borran usuarios, perfiles, contenido, restricciones de seguridad, planes de proveedores, configuración, programación, vigilante ni las pruebas históricas del cron. No se modifica el saldo externo de PayPal ni se cancelan suscripciones en el proveedor. Los envíos de dinero real siguen apagados.

Después se comprueban saldos de Créditos y de creadores, libro vacío, archivo íntegro y permisos privados. El archivo contiene datos financieros y no debe exponerse en el navegador ni en una carpeta pública. Recuperar movimientos históricos requiere una restauración supervisada a partir de ese archivo o del respaldo cifrado; el panel cotidiano no tiene un botón para borrar o restaurar libros.

Pruebas locales: `npm run test:finance-test-reset`, con PGHOST local y base desechable. Incluyen el reinicio en cero, reversión completa de la transacción, protección contra cambios posteriores, conservación de perfiles, avisos antiguos, nuevos y contradictorios, privacidad e inmutabilidad del archivo.
