# KALAK web

Aplicación web independiente en **React + TypeScript + Tailwind CSS + Vite**, con las mismas cuentas, datos y operaciones transaccionales de Supabase que Android. No usa React Native Web ni necesita Next.js: el backend existente resuelve autenticación, permisos y transacciones.

## Versión 1.6.1

El encabezado de cada punto de retiro muestra los productos pendientes en una lista vertical de cantidades, en lugar del importe agrupado. Incluye pedidos pagados y por pagar dentro de los filtros actuales; excluye entregados, cancelados y devueltos. Los importes de cada pedido se conservan.

El paquete local está actualizado a **1.6.1**. La URL de producción existente indicada abajo **no se volvió a publicar** con este cambio.

## Desarrollo

Node 24 LTS y npm. Desde la raíz del repositorio:

```sh
npm ci --prefix web
cp web/.env.example web/.env.local
```

Completar en `web/.env.local`:

```dotenv
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=clave_publicable
```

Usar la URL y la clave **publicable** de la misma instancia que Android. No usar una clave `service_role` o secreta. Las variables `VITE_*` son públicas y se incorporan al compilar. No hay datos de ejemplo ni cuentas de demostración en producción.

```sh
npm run web:dev
npm run web:build
npm run web:test
```

También se pueden ejecutar `npm run dev`, `npm run build` y `npm test` dentro de `web/`.

## Vercel

**Producción publicada:** https://kalak-logistica.vercel.app. Ver [registro de despliegue y comprobaciones](../docs/WEB-DEPLOYMENT.md). El proyecto está vinculado localmente como `kalak-logistica` en `morguimateos-projects`; los demás sitios KALAK no se modificaron.

Importar **este repositorio completo** y dejar **Root Directory en la raíz** (vacío o `.`). El [vercel.json](../vercel.json) ya configura:

| Opción | Valor |
| --- | --- |
| Framework | Vite |
| Install Command | `npm ci --prefix web` |
| Build Command | `npm --prefix web run build` |
| Output Directory | `web/dist` |
| Node.js | 24.x |

Agregar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en los entornos de Vercel que correspondan **antes** del build. Volver a desplegar cuando cambien; no son configuración dinámica en tiempo de ejecución. No hace falta instalar las dependencias Expo para compilar la web. Las utilidades puras de `../src/lib` se comparten con Android y se incluyen en el build.

En Supabase Auth → URL Configuration, registrar el dominio final como Site URL y las URLs de redirección de confirmación permitidas. Mantener las URLs necesarias para Android. Las rutas `/clientes`, `/stock`, `/resumen` y `/ajustes` admiten acceso directo y recarga mediante el rewrite de SPA.

La web no aplica migraciones ni crea administradoras. La instancia debe estar actualizada para Android 1.6.0, incluidas las capacidades de regalos y edición de entregados. Usar las cuentas existentes y su punto asignado. No repetir el bootstrap ni la carga inicial sobre datos existentes.

## Seguridad y funcionamiento

- La autorización real permanece en los RPC y las políticas de Supabase; los controles de interfaz no los reemplazan.
- Responsable: Ventas, Clientes y Stock de su punto. Administradora: acceso adicional a Resumen y Ajustes.
- Sin conexión se puede consultar únicamente la instantánea de la sesión actual; guardar exige conexión. No se persisten instantáneas de negocio en disco ni se comparten entre cuentas.
- Autenticación persistente mediante Supabase Auth. El caché de consultas se descarta al salir o cambiar de usuario.
- Operaciones idempotentes: identificadores pendientes por cuenta para reintentar respuestas inciertas sin duplicar pedidos, pagos o stock. La edición conserva las versiones de concurrencia.
- Sincronización cada 60 segundos mientras la pestaña está visible, al recuperar foco/conexión y por novedades compartidas. Botón Actualizar siempre disponible.
- Fechas de negocio de Mendoza, importes ARS y cálculos compartidos con Android. Archivos Excel reales, CSV y respaldo JSON descargables desde el navegador.
- La interfaz replica los módulos operativos actuales. Compras y producción por recetas históricas siguen sin exponerse, igual que en Android.

## Verificación

```sh
npm run web:typecheck
npm run web:test
npm run web:build
npm test
npm run typecheck
```

Las pruebas web usan datos sintéticos y RPC simulados, sin escribir en la instancia operativa. La comprobación de operaciones reales necesita una cuenta habilitada y un entorno de prueba. Ver [contrato funcional](../docs/KALAK.md) y [paridad web](../docs/WEB-PARITY.md).

Además de esas pruebas automatizadas, se ejecutaron flujos de navegador contra Supabase Auth, JWT, PostgREST y SQL reales en una base local descartable: entrega, cobro posterior, cliente/mascota, ajuste de stock, exportaciones y permisos por punto. No se crearon movimientos de prueba en producción. Para reproducir el entorno aislado, `node scripts/preview-kalak.mjs` genera una configuración temporal privada; no usarla para desplegar ni copiar sus credenciales al repositorio. Detalles y límite de aceptación de la cuenta productiva en el [registro](../docs/WEB-DEPLOYMENT.md).
