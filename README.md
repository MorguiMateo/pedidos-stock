# KALAK logística

Aplicación Android/web en español para cargar pedidos directamente, sin depender de Nooty. React Native + Expo + Supabase; importes ARS y día comercial de Mendoza.

**Código fuente privado:** [MorguiMateo/pedidos-stock](https://github.com/MorguiMateo/pedidos-stock). Rama principal: `main`. La plantilla `.github/ci.example.yml` prepara verificaciones de TypeScript, pruebas compartidas/web y build web. Para activarla debe moverse a `.github/workflows/ci.yml` usando una sesión GitHub con permiso `workflow`; la sesión actual permite subir el código, pero no activar workflows. Las pruebas SQL necesitan Docker y se ejecutan por separado. Los secretos, respaldos, APK y claves de firma quedan fuera de Git.

## Esta versión

- Versión **1.8.0**: inicio reorganizado, productos abreviados en vertical (FP/FG/CC/VIN/SEM/K/BOL), acciones compactas de entrega/cobro con transferencia predeterminada y confirmación de cambios de medio. Alta completa de cliente desde el pedido, punto habitual y repetición del último pedido. Mascotas con anotaciones, foto JPEG y edad fechada/actualizada. Reglas semanales de retiros con excepciones manuales, no retirados desde las 20:45 de Mendoza y análisis mensual financiero con calendario, clientes únicos, ticket, productos por punto, gráficos, pronóstico y simulador de equilibrio.
- Versión **1.7.0**: Mendieta habilitado como administrador, con inventario inicial, ajuste de stock y transferencias. Ventas muestra las cantidades totales por producto del día y por punto (pendientes y entregados, sin cancelados ni devueltos), separadas de la preparación pendiente. Resumen agrega cobros reales en efectivo con rango de fechas inclusivo, punto, reintegros/correcciones, detalle y hojas Excel; nunca suma medios previstos ni saldos por cobrar.
- Versión **1.6.1**: cada punto de retiro muestra los productos pendientes y sus cantidades en una lista vertical, en lugar del importe agregado. Incluye pendientes ya pagados; excluye entregados, cancelados y devueltos. Los importes individuales de cada pedido se conservan.
- Versión **1.6.0**: bolsas de regalo solo en la primera compra, dentro del pedido y con control de stock; edición de pendientes y entregados con ajustes por diferencia. Pedidos compactos con productos/importe/pago/entrega visibles, controles desplegables, cantidades normalizadas, borrado confirmado, pago Gratis y cambio de medio de pago. Mascotas perro/gato y punto preferido de retiro.
- Sincronización automática cada 60 segundos mientras la app está activa y botón **Actualizar** siempre visible. Las novedades compartidas y los cambios guardados siguen actualizándose sin esperar al próximo minuto.
- Cuentas personales: administradora con acceso general y responsables limitados a su punto de retiro. Auditoría con usuario, fecha e historial de cambios.
- Calendario como primera vista, con pedidos del día desplegables por punto de retiro. Cliente, productos, cantidades, total y controles de entrega y pago visibles sin abrir el detalle. Vistas diaria/semanal/mensual y filtros por punto, cliente, producto, entrega y pago.
- Pedidos con varios productos, cliente existente o alta rápida por nombre/teléfono. Precios históricos, preparación, observaciones, reprogramación y cancelación.
- Ventas espontáneas con cliente opcional: independientes o agregadas a un pedido pendiente del mismo cliente/punto, con entrega y cobro conjuntos. Descuentan stock físico una sola vez, sin consumir reservas de otros pedidos.
- Reservas de stock y producción futura por fecha, sin doble conteo. Aviso de déficit sin cobertura al agendar, con confirmación explícita para guardar igualmente. Una entrega o venta espontánea siempre exige stock físico.
- Carteles del color del punto para pedidos nuevos con retiro hoy, que abren la operación. No se notifican pedidos con retiro futuro ni se anuncian como nuevos los pedidos ya conocidos.
- Entrega y pago separados: **Pagado / Por pagar**, **Efectivo / Transferencia / Gratis**. Gratis no registra dinero ni deuda; los cambios de medio corrigen la caja mediante contramovimientos trazables. El medio previsto se guarda incluso antes de cobrar, sin registrar un pago. Una entrega puede quedar pendiente de cobro. No se generan nuevos pagos parciales; los anteriores se conservan.
- Catálogo administrable: categorías, kg o unidad, presentación física separada, contenido por envase, cálculo de envases, fechas de precio, mínimos y desactivación sin borrar ventas.
- Inventario inicial manual de productos terminados y ajustes sin solicitar motivo; las transferencias entre puntos conservan su motivo obligatorio. Los movimientos mantienen descripciones automáticas de auditoría; no exige compras ni recetas.
- Informes de ventas por producto, preparación por punto, pedidos frente a clientes únicos, seguimiento y recompra configurable, entregados por cobrar, cobros por medio, stock y movimientos. Exportación Excel **.xlsx**, CSV y respaldo JSON.
- Errores comprensibles, guardado online transaccional, controles de concurrencia e identificadores idempotentes para reintentar sin duplicar operaciones.

**Stock → Cocina central** permite prever producción sin recetas ni inventario físico, reservar pedidos anticipados y consultar qué necesita cada punto. Los ingresos reales se cargan en los puntos y reducen las previsiones automáticamente. Compras, proveedores, materias primas y elaboración por recetas siguen sin exponerse; sus historiales se conservan. Ver [flujo de producción prevista](docs/ANDROID.md#cocina-central).

## Ejecutar

### Web React + Tailwind para Vercel

La versión web independiente está en [`web/`](web/README.md). Usa **Vite + React + Tailwind CSS** y comparte el backend y las reglas de negocio de la APK sin modificar Android.

**Producción:** https://kalak-logistica.vercel.app · [Despliegue y verificación](docs/WEB-DEPLOYMENT.md).

```sh
npm ci --prefix web
cp web/.env.example web/.env.local
# Completar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.
npm run web:dev
```

Para Vercel, importar el repositorio con **Root Directory en la raíz**: `vercel.json` ya define instalación, build, salida y rutas. Ver [configuración y despliegue web](web/README.md#vercel).

### Android / Expo

Requisitos: Node 24 LTS y npm; Docker para verificar el backend local.

```sh
npm ci
cp .env.example .env
```

Completar `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con la URL y **clave publicable** del proyecto. Nunca incorporar credenciales service-role en la app.

```sh
npm start
npm run web
```

## Actualizar una instalación

La instancia compartida fue actualizada el **28/10/2026**, con respaldo previo y preservación verificada de 27 pedidos, 173 clientes y 14 artículos. La APK **1.6.0**, `versionCode: 8`, conserva paquete y firma para actualizar sin desinstalar: `artifacts/kalak-logistica-1.6.0.apk`. Se aplicaron las migraciones de medio previsto, producción futura y bolsas de primera compra/edición. En ese despliegue la cuenta Mendieta quedó como responsable; el **29/10/2026 se promovió a administrador** con acceso general, sin cambiar datos de negocio. Las instrucciones siguientes sirven para otras instalaciones o futuros despliegues; no repetir el bootstrap de esta instancia.

APK actual **1.8.0**, `versionCode: 11`: [descargar APK firmado](artifacts/kalak-logistica-1.8.0.apk). Conserva paquete y certificado para actualizar sin desinstalar. Requiere las migraciones `20261030120000_pet_profiles.sql` y `20261030130000_weekend_pickup_availability.sql`. Las APK anteriores se eliminan al entregar esta versión, a pedido del usuario.

Las versiones históricas 1.6.0, 1.6.1 y 1.7.0 conservan su registro de verificación en `artifacts/evidence/`, pero sus APK ya no se distribuyen.

**La base compartida no se actualiza automáticamente.** Hacer una copia antes de aplicar cambios y revisar las migraciones pendientes. Aplicar en orden todas las migraciones de `supabase/migrations`, incluidas `20261024152000_hosted_auth_bridge.sql`, `20261026150000_planned_order_payment_method.sql`, `20261028120000_production_planning_sales.sql` y `20261028160000_first_purchase_gifts_editable_orders.sql`, antes de distribuir esta app. La migración es aditiva y conserva ventas, stock y cobros históricos, pero revoca el anterior acceso anónimo.

1. Habilitar Supabase Auth por correo/contraseña y configurar las URLs/correos de confirmación para la instalación.
2. Crear o solicitar la primera cuenta personal. Desde un entorno servidor de confianza o el SQL Editor de Supabase, ejecutar una sola vez, con el UUID real de esa cuenta:

   ```sql
   select public.app_bootstrap_admin('UUID-DE-LA-CUENTA'::uuid, 'Nombre administradora');
   ```

3. Ingresar con esa cuenta. Las demás personas solicitan acceso desde el ingreso; la administradora las habilita y asigna su punto en **Ajustes → Usuarios internos**.
4. Revisar catálogo, unidad comercial y contenido por envase con los datos reales. No se convierte automáticamente el stock histórico de unidades a kg; las unidades ya usadas no pueden cambiarse sin reconciliar su historial.
5. Cargar el inventario inicial por ubicación, o conservar los saldos ya existentes. La carga inicial **suma** unidades: no repetirla sobre un saldo cargado.
6. Cargar pedidos y ventas directamente desde **Ventas**. Nooty y la importación histórica no son necesarios para operar.

Las cuentas sin asignación no acceden a datos. El respaldo de negocio no reemplaza una copia de Supabase Auth; ver [recuperación](docs/RECOVERY.md). Las consultas sin conexión se limitan a la sesión actual en memoria; no se comparte una copia persistida entre personas.

## Verificación

```sh
npm run typecheck
npm test
node scripts/test-kalak-backend.mjs
```

La prueba KALAK requiere el contenedor local Supabase Postgres, crea bases descartables y comprueba instalación limpia, actualización con historial, roles, reservas, kg, precios, pagos, auditoría y carreras con conexiones independientes. No resetea la base operativa ni modifica el proyecto remoto. Los scripts y suites de etapas anteriores documentan contratos históricos; ver [verificación](docs/VERIFICATION.md) para sus condiciones de uso.

## Android y documentación

La APK debe recompilarse después de migrar la base; un artefacto anterior no incorpora estos cambios.

- [Despliegue](docs/DEPLOYMENT.md)
- [Contrato de negocio actual](docs/KALAK.md)
- [Backend](docs/BACKEND.md)
- [Android](docs/ANDROID.md)
- [Seguridad](docs/SECURITY.md)
- [Respaldo y recuperación](docs/RECOVERY.md)
