# APK Android local

La app se compila como **release firmado y autónomo**, paquete `com.pedidosstock.app`. Incluye el JavaScript/Hermes y las cuatro arquitecturas Android en un APK universal; no necesita Expo Go ni Metro.

## Requisitos

- macOS o Linux, Node.js 24 LTS, JDK 17, `curl`, `unzip`, `openssl` y espacio libre para SDK/NDK/Gradle.
- Dependencias del proyecto: `npm ci`.
- `.env` con `EXPO_PUBLIC_SUPABASE_URL` (HTTPS) y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La clave pública es para el cliente; **nunca** usar una clave `service_role` en la app.

```sh
bash scripts/setup-android.sh
npm run android:release
```

El instalador usa herramientas oficiales de Google y valida el ZIP inicial con el checksum del manifiesto oficial. No modifica perfiles globales. Por defecto guarda todo en `~/.local/share/pedidos-stock-tools/`; se puede personalizar con `PEDIDOS_TOOLS_DIR` y `ANDROID_HOME`. En macOS selecciona JDK 17 mediante `java_home` si no se definió `JAVA_HOME`.

## Firma de producción

`scripts/create-signing.sh` genera una clave RSA de 4096 bits y contraseñas aleatorias; conserva la existente en ejecuciones posteriores. La clave y su archivo de entorno están fuera del repositorio:

```text
~/.local/share/pedidos-stock-tools/signing/pedidos-stock-release.jks
~/.local/share/pedidos-stock-tools/signing/release.env
```

El directorio tiene permisos `0700`; ambos archivos, `0600`. **Respaldá este directorio de forma segura:** la misma firma es necesaria para actualizar instalaciones existentes. No se debe compartir `release.env`, subirlo a Git ni pegarlo en logs. El plugin de Expo elimina la firma debug del build release y falla si faltan credenciales.

## Resultado y verificación

La salida actual está en `artifacts/kalak-logistica-1.6.0.apk` y su SHA-256 en `artifacts/evidence/release-1.6.0/kalak-logistica-1.6.0.apk.sha256`. El script ejecuta `apksigner verify` y verifica que el APK contenga el bundle de JavaScript. Para instalar por USB, con depuración USB habilitada:

```sh
~/.local/share/pedidos-stock-tools/android-sdk/platform-tools/adb install -r artifacts/kalak-logistica-1.6.0.apk
```

También se puede copiar el APK al teléfono y abrirlo, permitiendo la instalación desde esa fuente. No es una publicación en Google Play. Para una próxima versión, incrementar `expo.version` y `android.versionCode` en `app.config.ts` y reutilizar la firma.

## Actualización KALAK logística 1.6.0

Versión `1.6.0`, `versionCode: 8`, mismo paquete y certificado. Instalar como actualización, sin desinstalar.

### Bolsa gratis en la primera compra

En **Nuevo pedido / Editar pedido**, seleccionar cliente y agregar la **Bolsa de tela** junto con los productos comprados. Activar **Bolsa gratis · primera compra** en esa línea y elegir la cantidad. Las bolsas aparecen como **Regalo**, cuestan $0 dentro del mismo pedido y mantienen la cantidad completa para reservas, entrega y stock. El alimento sigue cobrándose con su medio de pago habitual: no usar **Gratis** para todo el pedido cuando solo se regalan las bolsas.

El servidor verifica el historial global del cliente, aunque se opere desde un único punto. El regalo se puede reservar en un solo pedido y corresponde a la primera compra comercial entregada, no a muestras gratuitas previas. Si la primera compra ya fue entregada, se puede editar ese mismo pedido para agregar o corregir las bolsas; no corresponde regalar en una segunda compra. Cancelar o borrar un pedido aún no entregado libera su reserva del beneficio. Devolver o borrar una compra ya entregada no habilita regalos repetidos.

La **Bolsa de tela** existente queda habilitada automáticamente. En **Ajustes → Catálogo**, el control **Bolsa de regalo de primera compra** permite administrar los productos por unidad que representan esas bolsas. Su precio de venta normal se mantiene para las compras siguientes. El precio de lista histórico se conserva al activar/desactivar un regalo en el pedido.

### Editar pedidos entregados

Desplegar el pedido y elegir **Editar pedido entregado**. Productos, cantidades y datos se modifican en el mismo pedido, conservando su estado y fechas de creación/entrega. El stock se corrige únicamente por la diferencia: cambiar notas u horario no vuelve a descontarlo. Agregar unidades exige stock real libre, sin consumir las reservas de otros clientes. Reducir un importe ya cobrado muestra previamente el reintegro que se registrará; los cobros anteriores se conservan con sus correcciones auditadas. Aumentar un pedido cobrado puede dejar un nuevo saldo pendiente.

Requiere `20261028160000_first_purchase_gifts_editable_orders.sql`. Los respaldos conservan `is_gift`, `list_unit_price` y el historial persistente de primera compra; las restauraciones anteriores reciben valores seguros sin inventar regalos ni volver elegibles a clientes que ya compraron.

## Actualización KALAK logística 1.5.0

Versión `1.5.0`, `versionCode: 7`, mismo paquete y certificado. Instalar encima de la aplicación anterior, sin desinstalar.

- Pedidos compactos y desplegables con productos, importe, entrega y pago visibles; calendario y resumen por punto cuentan solo retiros pendientes.
- Cantidades editables normalizadas, sin ceros decimales innecesarios; se conservan precios y datos no editados. Medio de pago modificable incluso después del cobro, con correcciones de caja trazables.
- Medio **Gratis**: sin deuda ni ingreso ficticio; conserva cantidades y costo operativo. Borrado confirmado de pedidos erróneos: desaparecen de las vistas, compensando stock/caja cuando corresponde; permanece auditoría técnica.
- Venta espontánea independiente o agregada a un pedido pendiente del mismo cliente y punto, con entrega y saldo conjuntos. Los productos ya incluidos conservan su precio histórico; los nuevos usan el vigente.
- Mascotas perro/gato con emoji y punto preferido del cliente, usado por defecto sin impedir cambiarlo en un pedido.
- Responsable Mendieta sin Resumen/Ajustes; permisos y datos acotados también en el servidor. Productos inactivos ocultos por defecto, sin borrar historia.

### Cocina central

En **Stock → Cocina central**, cargar producto, cantidad y fecha en **Prever producción**. La unidad sale del catálogo; no requiere recetas ni genera movimientos físicos. Los pedidos reservan primero stock utilizable del punto (sin lotes que venzan antes del retiro) y después previsiones disponibles para su fecha, compartidas entre los puntos sin duplicarlas. Si no hay cobertura, se debe confirmar expresamente el faltante.

**Qué llevar a cada punto** muestra por producto y fecha: pedidos comprometidos, reserva física, previsión reservada, cantidad que falta recibir y déficit sin cobertura. Son sugerencias, nunca traslados automáticos.

Registrar los ingresos reales directamente en Mendieta, Salta o Carrodilla con **Inventario inicial/Ajustar inventario**. Los ingresos positivos descuentan la previsión más antigua del producto; las transferencias entre puntos no la descuentan otra vez. Para un resultado inferior al previsto, registrar primero los ingresos y después **Cerrar con cantidad real**: se retira el remanente futuro y se muestran los compromisos sin cubrir. El cierre tampoco suma stock. Las correcciones de ingresos recuperan el compromiso vinculado. Los saldos antiguos en cocina se pueden trasladar a un punto, pero no se permiten nuevos ingresos de producto elaborado allí.

Requiere las migraciones `20261026150000_planned_order_payment_method.sql` y `20261028120000_production_planning_sales.sql`. El cliente detecta una base sin producción prevista y no intenta operar contra un contrato anterior. Los respaldos completos incluyen previsiones, ingresos vinculados y reservas futuras; el restaurador sigue aceptando respaldos anteriores.

## Actualización KALAK logística 1.4.0

Versión `1.4.0`, `versionCode: 6`, nombre visible **KALAK logística** e icono renovado. Conserva el paquete `com.pedidosstock.app` y el certificado de producción para actualizar sin desinstalar ni perder datos. El inventario inicial, los ajustes y las reversiones guardan automáticamente su descripción de auditoría; solo las transferencias entre puntos solicitan un motivo. En Ventas, la fecha y las acciones aparecen arriba; las ventas espontáneas usan siempre hoy. El calendario precede los pedidos completos por punto, con detalle, cantidades, total y pago; el stock/preparación es desplegable y los entregados por cobrar quedan debajo.

No requiere migraciones nuevas de base de datos. Las evidencias y el checksum de esta versión se guardan en `artifacts/evidence/release-1.4.0/`. Tras validar la nueva APK se retiran únicamente las APK anteriores y sus checksums de la raíz de `artifacts/`; las evidencias e importaciones se conservan.

## Actualización de sincronización 1.3.1

Versión `1.3.1`, `versionCode: 5`, con la misma firma. Cambia la consulta periódica de 15 a 60 segundos, solo con la app activa, y muestra el botón **Actualizar** con indicador de carga y bloqueo durante la consulta o sin conexión. Las consultas manuales reutilizan una solicitud en curso en lugar de cancelarla y lanzar otra. Se conservan las actualizaciones al volver a la app, reconectar, guardar cambios y recibir novedades compartidas.

Este cambio de interfaz requiere instalar la APK nueva encima de la anterior; no requiere migraciones de base de datos. Agregar clientes en Supabase, en cambio, no requiere recompilar.

## Actualización de calendario 1.3.0

Versión `1.3.0`, `versionCode: 4`, paquete y certificado de producción sin cambios. Incluye el calendario como primera vista, pedidos del día desplegables por punto de retiro, cliente/productos/cantidades/total visibles y controles de entrega y pago. Permite guardar efectivo o transferencia como medio previsto sin registrar un cobro.

Antes de usar la selección del medio previsto, aplicar `20261026150000_planned_order_payment_method.sql` en Supabase. Compilar esta APK no aplica esa migración ni modifica datos del servidor compartido. No se debe desinstalar la app existente: usar la actualización con la misma firma.

## Herramientas del proyecto

Las versiones de API, Build Tools y NDK se derivan de `node_modules/react-native/gradle/libs.versions.toml`, fijado por `package-lock.json`. Para este proyecto: Gradle 9.4.1, AGP 9.2.1, API de compilación 37, target 36, Build Tools 37.0.0, NDK 27.1.12297006 y CMake 3.30.5. Google publica API 37 como `platforms;android-37.0`.

Referencias oficiales: [compatibilidad AGP 9.2](https://developer.android.com/build/releases/agp-9-2-0-release-notes), [herramientas de línea de comandos](https://developer.android.com/tools), [firma de aplicaciones](https://developer.android.com/studio/publish/app-signing).

La primera compilación descarga herramientas y dependencias y puede tardar varios minutos. Los siguientes builds reutilizan las cachés locales. El APK siempre incorpora las variables públicas disponibles al compilar: si cambia el proyecto Supabase, hay que recompilarlo.

El script conserva el proyecto nativo (`prebuild --no-clean`) y fuerza únicamente la generación del bundle JavaScript en cada build. Esto evita reutilizar un backend o una clave pública incorporados en una compilación anterior. Gradle usa hasta 4 GiB de heap y 1 GiB de metaspace; se puede limitar la concurrencia con `PEDIDOS_GRADLE_WORKERS`.

## Verificación histórica de la versión 1.0.0

El release se instaló desde cero en un emulador ARM64 con Android 16/API 36, sin puertos Metro redirigidos. Se verificaron las cinco pestañas, cabecera y etiquetas inferiores completas, ausencia de errores `AndroidRuntime`/`ReactNativeJS`, y las cuatro arquitecturas del APK. También se activó modo avión, se cerró el proceso y se abrió de nuevo: los datos persistidos siguieron visibles, la app indicó que eran datos guardados y la acción de crear un artículo quedó deshabilitada. Se restauró la conectividad al finalizar. No se crearon datos comerciales de prueba en la nube durante esta verificación nativa.

Las capturas, árboles de accesibilidad y el resumen de verificación están en `artifacts/evidence/`. El archivo `android-verification.json` registra el SHA-256 del APK verificado. El certificado de firma es de producción (RSA 4096), no `Android Debug`; el APK fue validado con APK Signature Scheme v2, compatible con el mínimo Android 7/API 24 del proyecto.

## Actualización 1.1.0

La versión nueva usa `versionCode: 2` y la misma firma para actualizar la instalación existente. Agrega módulos nativos de exportación de archivos: es necesario recompilar, no basta reemplazar JavaScript. Aplicar antes la migración de negocio `20261023120000_business_expansion.sql`. La app detecta un servidor anterior y solicita esa actualización; no trata de escribir campos nuevos contra una base antigua.

## Actualización KALAK 1.2.0

La APK usa `versionCode: 3`, conserva el identificador `com.pedidosstock.app` y reutiliza el certificado de producción anterior. Se instala **encima** de las versiones 1.0.0/1.1.0 firmadas con esa misma clave: abrir el archivo y elegir actualizar, sin desinstalar la app existente. No crea una segunda aplicación.

Antes de distribuirla, aplicar todas las migraciones pendientes hasta `20261023180000_kalak_identity_sales.sql`, preparar Supabase Auth y habilitar la primera administradora. El servidor compartido fue actualizado el 24/10/2026 y la primera administradora ya está habilitada; la corrección de permisos administrados `20261024152000_hosted_auth_bridge.sql` también está aplicada. Generar una APK por sí solo no aplica migraciones en otras instalaciones. Las versiones anteriores dejan de tener acceso anónimo después de migrar; coordinar ese cambio con la instalación de la APK nueva. Los pasos de alta y aprobación están en [README](../README.md).

La APK incorpora la configuración HTTPS del backend compartido, no un servidor temporal de pruebas. No se incluye ninguna contraseña de usuario ni clave privilegiada.

### Prueba de actualización 24/10/2026

La APK 1.2.0 se compiló y verificó con `apksigner`. Las APK 1.0.0, 1.1.0 y 1.2.0 comparten paquete y certificado SHA-256 `a0d5e268022d8fb21fb4f9b09ef92b9f194982437eb904a6bc1ec7b221007452`; sus versionCode son 1, 2 y 3.

Se instaló la 1.2.0 mediante `adb install -r` sobre la 1.0.0 del emulador API 36, **sin desinstalar ni borrar datos**. La instalación final tiene versionCode 3, conserva `firstInstallTime` y `dataDir`, y el administrador de paquetes registra una sola app. Evidencias: `artifacts/evidence/update-1.2.0/apk-compatibility.json` e `install-update.json`. Las APK anteriores y sus archivos SHA-256 se eliminaron el 26/10/2026; la APK 1.2.0 también se eliminó tras verificar la compilación 1.3.0. Las evidencias históricas de esta actualización se mantienen y no se reemplazan las claves de firma.

Esta prueba inicial validó el instalador y el arranque. Posteriormente se activó el backend remoto y se verificaron el ingreso real de administración, el alcance y la preservación de datos; ver [despliegue](DEPLOYMENT.md).


## Actualización 1.7.0 — 29/10/2026

APK `artifacts/kalak-logistica-1.7.0.apk`, versión 1.7.0 / código 10. Conserva `com.pedidosstock.app` y el certificado de producción; instalar como actualización sin desinstalar.

- Mendieta ya está habilitado como administrador en el backend compartido. Al actualizar la información de la sesión aparecen inventario inicial, ajustes y transferencias de stock, además de Resumen/Ajustes.
- Ventas: total diario por producto y punto, con pendientes y entregados; no cuenta cancelados o devueltos. No cambia al filtrar la lista por pago/preparación/cliente/producto. La preparación pendiente sigue separada.
- Resumen: efectivo recibido, reintegros/correcciones y neto por punto. Desde/hasta inclusivos por fecha efectiva del movimiento, independientes del mes. No incluye deudas, efectivo previsto, transferencias ni egresos; conserva cobros históricos de pedidos cancelados/devueltos y sus contramovimientos.
- Excel: nuevas hojas de efectivo, con el rango y punto seleccionados. No requiere migración ni reinventario.
