# Verificación KALAK 1.6.0 — 28/10/2026

- TypeScript aprobado; **99 pruebas Vitest** y **154 aserciones SQL** aprobadas (49 nuevas de regalos/edición, 26 de identidad, 23 de pagos y 56 de producción). Registro SQL: `artifacts/evidence/release-1.6.0/sql-tests.log`.
- Reservas de regalo simultáneas entre puntos, ediciones concurrentes de entregados, reintentos idempotentes, conflictos de versión, instalación nueva y actualización de base con datos verificados en bases descartables.
- Recuperación de respaldos: cinco grupos aprobados, incluidos precios de lista mayores a 2^53 sin pérdida, pedidos mixtos alimento/bolsa gratis, productos agregados y primera compra comercial persistente. Los respaldos anteriores conservan el historial comercial sin inventar regalos.
- Navegador integrado: primera compra de alimento cobrado y bolsa gratis en un único pedido; stock real al entregar; edición entregada con diferencias de cantidades; guardado posterior de notas sin nuevo descuento; segunda compra con regalo deshabilitado; reducción de total con reintegro exacto; devolución y auditoría de regalos. Gateway de prueba solo Auth/RPC: los 404 WebSocket esperados se documentan en el informe, no fueron fallas de los flujos.
- Nube: migración con respaldo previo y conservación exacta de 27 pedidos, 173 clientes, 14 artículos, stock y caja. Sin operaciones comerciales de prueba.
- APK `1.6.0` / código 8, mismo paquete/certificado; actualización instalada sobre 1.5.0 en Android API 36, conservando `firstInstallTime` y directorio de datos. Evidencia y checksum en `artifacts/evidence/release-1.6.0/`.

---

# Verificación KALAK 1.5.0 — 28/10/2026

- TypeScript aprobado; **90 pruebas Vitest** y **105 aserciones SQL** aprobadas.
- Instalación limpia, actualización de base no vacía, reservas futuras concurrentes entre puntos e idempotencia de ventas agregadas/borrados verificadas en bases locales descartables.
- Recuperación completa de exportaciones con previsiones, ingresos vinculados, reservas decimales, pedidos gratis, historial de precios y dinero mayor a 2^53; respaldos anteriores, referencias inválidas y rollback también verificados.
- Navegador integrado: edición sin alterar otros datos, mascotas/punto preferido, producción futura → pedido anticipado → ingreso real → menor producción/alerta, gratis sin caja ficticia, venta agregada/cobro único y borrado confirmado. Vista móvil revisada a 390 px. El gateway descartable no implementa realtime; sus 404 WebSocket esperados se detallan en el informe, y la actualización RPC sí se comprobó.
- Nube: migraciones aplicadas con respaldo previo; preservados **27 pedidos, 173 clientes y 14 artículos**, sin operaciones comerciales de prueba. Cuenta Mendieta autenticada, acotada a su punto y bloqueada en endpoints administrativos.
- APK universal firmada, versión 1.5.0/código 7, instalada encima de 1.2.0 en Android API 36: mismo paquete/firma, `firstInstallTime` y directorio de datos conservados. Ingreso nativo Mendieta aprobado, sin Resumen/Ajustes y sin errores AndroidRuntime/ReactNativeJS. Sesión de prueba cerrada al finalizar.
- APK anterior 1.4.0 eliminada después de verificar la nueva. Evidencias, checksum e informe reproducible en `artifacts/evidence/release-1.5.0/`; registros históricos conservados.

---

# APK 1.3.0 — 26/10/2026

Última APK compilada: `artifacts/pedidos-stock-1.3.0.apk` (96,870,588 bytes). SHA-256: `22a464bba487d355188330f4f85818020f8c194b7c13fe7884e46a08f275fb99`.

- `versionName: 1.3.0`, `versionCode: 4`, paquete `com.pedidosstock.app`.
- Firma de producción verificada con `apksigner`; mismo certificado que las versiones anteriores: `a0d5e268022d8fb21fb4f9b09ef92b9f194982437eb904a6bc1ec7b221007452`.
- APK universal con armeabi-v7a, arm64-v8a, x86 y x86_64, y bundle JavaScript/Hermes incorporado. Se verificó que el bundle es distinto al de 1.2.0 e incluye el nuevo medio de pago previsto y controles de pedido.
- TypeScript aprobado y 72 pruebas unitarias aprobadas. No se afirma una nueva instalación o prueba nativa en dispositivo para esta compilación.
- Las APK anteriores, incluida 1.2.0, sus SHA-256 y los logs de compilación/actualización de 1.2.0 se eliminaron después de verificar 1.3.0. Los apartados siguientes documentan resultados históricos, no archivos APK que sigan disponibles.
- Esta compilación no modifica el servidor compartido. Para guardar efectivo o transferencia como medio previsto se debe aplicar `20261026150000_planned_order_payment_method.sql` en Supabase.

Registro de verificación: `artifacts/verification-1.3.0.json`. Compilación: `artifacts/build-1.3.0.log`.

---

# Activación remota — 24/10/2026

El servidor de la APK 1.2.0 está actualizado y tiene una administradora activa. Se verificó ingreso por contraseña, perfil de administración, exportación completa, rechazo anónimo de RPC/tablas y preservación exacta de los registros originales (2 clientes, 4 pedidos, 4 líneas, 8 artículos). No se cargaron ventas o stock de prueba en producción. Respaldo PostgreSQL previo validado y copia JSON posterior, ambos protegidos fuera del repositorio. Evidencia sin contraseñas: `artifacts/evidence/update-1.2.0/cloud-activation.json`.

La corrección `20261024152000_hosted_auth_bridge.sql` resuelve el permiso no delegable del esquema Auth administrado manteniendo el rol de negocio restringido. La APK 1.2.0 también inició sesión contra el servidor real y mostró la agenda con el perfil de administradora; evidencia sin credenciales en `native-cloud-login.json`. La sesión de prueba se cerró. Las pruebas de actualización y recuperación con la corrección aprobadas incluyen **26 aserciones pgTAP**.

La suite local ahora simula expresamente la ausencia de USAGE y SELECT directos a Auth en ese rol, además de instalación limpia y actualización histórica.

Los apartados siguientes son comprobaciones previas con su estado al momento de ejecutarse; el estado vigente del servidor es el de esta sección.

---

# APK 1.2.0 — 24/10/2026

APK universal firmada: `artifacts/pedidos-stock-1.2.0.apk` (96.865.036 bytes). SHA-256: `7c9b7358c627fa259e36e5c7b0afa0644a1c2b9ce4a0a3ebd62b4ac42e276c21`.

Mismo paquete y firma que 1.0.0/1.1.0; versionCode aumentado a 3. Instalación real con `adb install -r` sobre 1.0.0 aprobada, sin desinstalación, con fecha original y directorio de datos conservados y una sola aplicación registrada. Typecheck aprobado. Evidencias en `artifacts/evidence/update-1.2.0/`. El backend remoto continúa pendiente de migraciones y cuentas: no se afirma que esté activado para producción.

---

# Verificación KALAK — 23/10/2026

## Resultado actual

Tres subagentes GPT-6.1-Sol trabajaron en paralelo en backend, ventas/calendario y clientes/catálogo/informes, con integración y revisión cruzada.

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` | Aprobado |
| `npm test` | 70 pruebas en 10 archivos aprobadas |
| `node scripts/test-kalak-backend.mjs` | Instalación limpia, actualización con historial, roles, permisos, kg, precios/envases, stock, pagos, auditoría y carreras aprobados |
| pgTAP del contrato actual, ejecutado por la suite aislada | 24 aserciones aprobadas |
| `node scripts/test-recovery.mjs` | Recuperación exacta, formato anterior, integridad, referencias, lotes vencidos y rollback aprobados |
| `node scripts/test-api-upgrade.mjs` | Actualización aislada aprobada por el agente backend |

Las tres suites pgTAP anteriores hacen TAP-skip explícito cuando detectan el contrato autenticado: sus expectativas de acceso anónimo y nuevos pagos parciales ya no son válidas. No se contabilizan esas aserciones como aprobadas en la versión actual. La suite KALAK verifica el contrato nuevo en bases descartables, no sobre la base operativa.

## Recorrido real navegador → Auth → RPC → PostgreSQL

Se ejecutó `scripts/preview-kalak.mjs`, que crea una base y PostgREST descartables, una identidad temporal en Supabase Auth local y un gateway HTTP de prueba. No migra ni resetea la base original. Se verificó CORS y JWT real, sin inventar autenticación ni simular resultados RPC.

En el navegador integrado, ancho 359 px:

1. Pantalla de acceso, validación de campos vacíos y solicitud de cuenta personal.
2. Ingreso con la identidad temporal y carga de la agenda real del backend nuevo.
3. Cobro completo de una venta ya entregada por transferencia: consulta independiente SQL confirmó un único cobro de $3.000, entrega conservada, fecha de pago y un solo movimiento de salida de stock (sin repetir la entrega).
4. Nuevo pedido de hoy por 30 kg en Mendieta: se mostró el diálogo con opciones revisar/agendar con faltantes. Tras confirmación, SQL verificó una única nueva operación, marca de faltante y físico intacto en 19,5 kg.
5. Se mostró el cartel del punto; al pulsarlo se abrió el pedido exacto con su detalle e historial.
6. Informes renderizados sin desbordamiento horizontal (`scrollWidth === innerWidth === 359`). Exportar `.xlsx` generó el archivo y el mensaje de preparación sin error visible. Las pruebas unitarias abren el ZIP y XML para comprobar estructura y textos inertes.
7. Consulta de inventario por ubicación y navegación a los módulos actuales.

El gateway de prueba es HTTP/polling: no se afirma aquí haber verificado Realtime websocket de la nueva versión ni una notificación push. Las notificaciones operativas son carteles dentro de la app activa. No se compiló ni publicó una APK nueva en esta revisión. El backend remoto no fue modificado.

## Registro histórico (no describe el contrato actual)

# Revisión de pagos y fechas de retiro — 23/10/2026

## Resultado de esta revisión

- Tres subagentes GPT-6.1-Sol trabajaron en backend, ventas/pagos y calendario/clientes, con integración y comprobación final del coordinador.
- `npm run typecheck`: aprobado.
- `npm test`: **42 pruebas en 8 archivos**, aprobadas; incluye estados de cobro derivados del libro, reintegros/reversiones, historial por cliente y cierres por punto/fecha.
- `node scripts/test-api-db.mjs`: **185 aserciones pgTAP** (32 originales + 81 de ampliación + 72 de pagos/calendario), aprobadas con rollback.
- `node scripts/test-payments-calendar-concurrency.mjs`: cuatro carreras reales en PostgreSQL aislado: cierre contra creación, creación contra cierre, cierre contra reprogramación y dos liquidaciones simultáneas. Se verifica espera del bloqueo, rechazo del comando incompatible, ausencia de pedidos varados y cobro único.
- `node scripts/test-api.mjs`: los 11 escenarios HTTP previos siguen pasando, incluida notificación Realtime a otro cliente y protección de reservas/históricos.
- `node scripts/test-api-upgrade.mjs`: aprobado sobre las cuatro migraciones en base aislada.
- `node scripts/test-recovery.mjs`: aprobado; preserva nombres de transferencia y cierres, acepta respaldos v2 anteriores sin esos campos, conserva dinero mayor a 2^53 y valida integridad, referencias y reservas vencidas. Origen solo lectura; destinos PostgreSQL temporales.

## Recorrido real de pantalla a base local

1. Crear un pedido **No pagado** sin exigir forma de pago; verificar el estado sin abrir el detalle.
2. Intentar cerrar Mendieta para esa fecha: se muestra el pedido pendiente y el cierre está deshabilitado.
3. Usar **Cambiar día de retiro** desde ese aviso, seleccionar el día siguiente y guardar; verificar importe histórico conservado y contador actualizado.
4. Cerrar la fecha vacía con motivo. Crear otro pedido para Mendieta en esa fecha muestra el nombre, la fecha y el motivo del cierre. Reabrir la fecha.
5. Con stock local trazable, entregar el pedido con **ENTREGADO PERO FALTA PAGAR** y nombre opcional de transferencia. El pedido aparece en la sección global de pendientes, independientemente del calendario.
6. Cobrar desde esa sección por transferencia: el nombre previamente registrado se recupera, se persiste en el movimiento y el saldo pasa a cero; el pedido sale de pendientes y muestra **PAGADO**.
7. Abrir Clientes en 390×844: historial, consumo a precio histórico, cobrado neto y deuda correctos, sin desbordamiento horizontal (`scrollWidth === 390`). Se conserva la estética y el logo Kalak. Sin errores de consola capturados.
8. Eliminar únicamente las fixtures creadas por esta comprobación. Conteos locales iniciales recuperados: un pedido, seis movimientos de stock, dos lotes, cero movimientos financieros y cero cierres.

## Estado de publicación

La migración `20261023150000_payments_pickup_calendar.sql` se aplicó **solo localmente**, sin reset. La base alojada y el APK anterior no se modificaron. Para distribuir esta revisión hay que aplicar primero las migraciones pendientes al backend y generar un APK actualizado. La app detecta un servidor sin `pickup_closures` y pide la actualización, sin tratar la forma de pago prevista como un cobro real.

Registros de ejecución locales: `artifacts/payments-database.log`, `artifacts/payments-concurrency.log` y `artifacts/payments-recovery.log`.

---

# Verificación de ampliación 1.1.0 — 23/10/2026

## Resultado actual

- `npm run typecheck`: aprobado.
- `npm test`: 32 pruebas en cinco archivos; calendario, consumo histórico, caja, cuentas, fechas, CSV y operaciones.
- `node scripts/test-api-db.mjs`: 113 aserciones SQL (32 previas + 81 de ampliación), todas aprobadas y revertidas transaccionalmente.
- `node scripts/test-api.mjs`: 11 escenarios HTTP con conexiones independientes; carrera de producción, doble entrega, reservas, idempotencia, snapshots históricos, permisos y notificación Realtime a un segundo cliente. Aprobado. Un primer intento de Realtime agotó el tiempo durante la inicialización del servicio local; el diagnóstico y la repetición completa pasaron sin debilitar la prueba. La app conserva invalidación por eventos y agrega consulta de respaldo cada 15 segundos online/en primer plano.
- `node scripts/test-api-upgrade.mjs`: migración sobre base aislada con movimientos históricos previos; se conserva trazabilidad y no se rechazan retroactivamente consumos anteriores por fechas inferidas. Aprobado.
- `node scripts/test-recovery.mjs`: servidor origen solo lectura y PostgreSQL temporal nuevo; restauración exacta de tablas, UUID, importes, consumos/mermas, lotes, caja e idempotencia, incluyendo importes mayores a 2^53. Se rechazan alteraciones SHA-256, referencias inválidas, desajustes físicos y cantidades decimales convertidas a números JSON. Cada error revierte íntegramente la importación.
- Recuperación de respaldo envejecido: stock físico e historial exactos; las reservas se recalculan de forma derivada según vencimientos actuales en vez de reactivar lotes vencidos. Aprobado.
- APK universal release 1.1.0, versionCode 2: compilación Gradle correcta, firma RSA4096 con el mismo certificado de la instalación previa, `apksigner verify` aprobado y bundle JS incorporado. La APK 1.1.0 y su SHA-256 fueron eliminados el 26/10/2026 para conservar únicamente la última versión compilada; actualmente 1.3.0. No se afirma una verificación nueva en dispositivo físico o emulador para esta versión.

## Recorrido real de interfaz web local

En navegador integrado, viewport móvil 390×844:

1. Crear cliente con teléfono, correo y mascota Gala de 12,5 kg/dieta Fórmula perro; verificar persistencia y ficha.
2. Crear pedido de dos unidades, total automático $10.000, retiro 12:30 en Mendieta, Uber, dos bultos y uno preparado.
3. Registrar cobro parcial de $4.000; el detalle muestra saldo $6.000, sin confundir entrega con pago.
4. Crear y recuperar un nuevo punto de retiro con color configurable.
5. Preparar existencias mediante movimientos/lotes reales de prueba; fecha seleccionada con Mendieta 2, Carrodilla 1, Salta 1. Carrodilla ya entregado permanece en el contador aun filtrando el detalle por pendientes.
6. Editar preparación a dos bultos completos y confirmar la entrega desde el formulario; el contador de Mendieta no cambia.
7. La ficha del cliente consolida dos entregas, tres unidades y $15.000 históricos.
8. Devolver el pedido de Mendieta con reintegro físico y $1.000 de devolución monetaria, luego reintegrar los $3.000 restantes con acción separada. El neto cobrado queda en cero sin repetir el reintegro de stock.
9. Abrir Resumen con caja, cuentas, indicadores diarios/mensuales y descargar el respaldo completo JSON. Sin errores de consola capturados.

Los registros de verificación son exclusivamente locales y se eliminan al finalizar conservando los datos locales preexistentes. No se usó la base alojada para estas pruebas.

## Límites para publicar

La migración nueva no fue desplegada en el proyecto alojado. La APK apunta a la configuración pública existente y exige `schema_version:2`; aplicar la migración antes de distribuirla. El acceso anónimo heredado no autentica al personal; auditoría registra operación/fecha/motivo, no inventa una identidad. La integración fiscal requiere proveedor autorizado y credenciales. Las devoluciones son completas, no por renglones parciales. Las estimaciones de margen usan materias primas de referencia y no representan utilidad contable real.

---

# Registro histórico previo (1.0.0)

# Verificación de la entrega

## Código y backend

- TypeScript estricto: sin errores.
- 11 pruebas unitarias: importes exactos, fechas de retiro, límites mensuales de Mendoza, históricos, cancelados, reintentos idempotentes tras reiniciar y validación de fechas.
- 32 comprobaciones pgTAP: permisos, funciones, cantidades, precisión monetaria e invariantes.
- 11 escenarios de API local: concurrencia real entre conexiones, reservas, producción/entrega exactamente una vez, rollback, historial y actualizaciones Realtime.
- HTTPS público de Supabase: cuatro ubicaciones y cero registros de negocio.
- Cadena completa bajo rol anónimo en el servidor remoto, dentro de una transacción revertida. No quedan fixtures en la base alojada.
- Suscripción anónima a Realtime del proyecto alojado: `SUBSCRIBED`.

## Flujo completo desde interfaz móvil

Probado con datos temporales exclusivamente en Supabase **local**, desde el navegador a 412×915:

1. Crear ingrediente Harina en kg.
2. Crear producto Pan a $250,50 y receta de 2 unidades con 0,2 kg de harina.
3. Planificar compra de 1 kg a $100 y confirmar recepción.
4. Planificar e iniciar producción; consumir 0,2 kg.
5. Finalizar 2 unidades y transferirlas a Mendieta.
6. Crear cliente y pedido de 2 unidades: reserva completa, sin faltantes.
7. Entregar: descuento automático de existencias.
8. Resumen: pedidos y entregados $501; pendientes $0; compras $100.

La base alojada no contiene esos datos. Los contenedores locales se detuvieron conservando sus volúmenes de desarrollo.

## APK real

- Compilación release firmada, no cliente de desarrollo.
- Paquete `com.pedidosstock.app`, versión 1.0.0 / código 1.
- ABIs: arm64-v8a, armeabi-v7a, x86 y x86_64.
- Firma APK v2 válida con clave RSA de 4096 bits, fuera del repositorio.
- Bundle Hermes autónomo: incorpora el endpoint alojado, no localhost; no contiene la contraseña de la base.
- Instalación y apertura en emulador Android 36 ARM64, sin redirecciones ADB a Metro.
- Ventas, Compras, Stock, Producción y Resumen: navegación y selección accesible verificadas, sin errores de AndroidRuntime ni ReactNativeJS.
- Encabezado y etiquetas inferiores completos, sin recortes.
- Modo avión, cierre forzado y reapertura: snapshot persistido visible, aviso de desconexión y escritura deshabilitada.
- Reinstalación de la compilación final y nueva prueba offline: última actualización mostrada como 22 de octubre en Mendoza, aunque UTC ya era 23 de octubre.

Capturas y resultados nativos: `artifacts/evidence/`. La APK 1.0.0 y su SHA-256 fueron eliminados el 26/10/2026. El SHA-256 de la última APK compilada conservada está en `artifacts/pedidos-stock-1.3.0.apk.sha256`. Los avisos de dependencias pendientes se describen en [SECURITY.md](SECURITY.md).
