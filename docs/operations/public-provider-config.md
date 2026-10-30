# Consultas públicas de PayPal y LiveKit

Los GET públicos sirven para indicar la configuración disponible. No autentican claves con los proveedores, no enumeran salas y no comprueban saldos ni la autorización comercial de PayPal.

| Consulta | Campos permitidos | Significado |
| --- | --- | --- |
| `GET /api/paypal` | `enabled`, `clientId`, `env` | Existen los valores necesarios para mostrar el botón. El Client ID es el identificador público que necesita el navegador. |
| `GET /api/live-token` | `configured` | Existen los tres valores de configuración de LiveKit. |

No devuelven longitudes ni fragmentos de secretos, nombres internos de servidor, errores del proveedor ni estado del correo. Responden con `Cache-Control: no-store`. Que un indicador sea verdadero no certifica una conexión exitosa, permisos comerciales ni que el ejecutor de pagos esté habilitado.

Las operaciones POST conservan su autenticación, comprobación de importe, reservas, acceso y avisos firmados. Este cambio no añade migraciones, no altera precios, comisiones o saldos y no activa los Lives deshabilitados.

## Validación sin dinero ni credenciales

```sh
npm run typecheck
npm run test:public-config
npm run test:access
npm run e2e:paypal
npm run build
```

`test:public-config` utiliza los manejadores reales con valores ficticios y rechaza cualquier intento de red. Comprueba respuestas completas e incompletas, campos permitidos y ausencia de información privada. La prueba del valor `env=live` también usa únicamente valores ficticios, con la red bloqueada.

`test:access` firma permisos localmente y usa un servidor Supabase simulado en la interfaz de retorno local. `e2e:paypal` sustituye PayPal y Supabase por transportes ficticios. Ninguna de estas pruebas envía pagos, abre salas reales ni utiliza claves del proyecto.

El flujo `API security` ejecuta estas comprobaciones en GitHub para los cambios relevantes, sin secretos del repositorio ni permisos de escritura. La previsualización de Vercel comprueba además que la publicación se puede compilar; no sustituye las pruebas funcionales ni una prueba nativa de PayPal Sandbox.
