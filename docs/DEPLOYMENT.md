# KALAK 1.8.0 — 30/10/2026

Web y APK 1.8.0/código 11 publicadas y verificadas. Migraciones de mascotas y disponibilidad semanal aplicadas con respaldo previo y datos de negocio preservados. Las APK anteriores fueron eliminadas a pedido del usuario. Ver [entrega, verificaciones y límites de 1.8.0](RELEASE-1.8.0.md).

---

# KALAK 1.7.0 — 29/10/2026

- Mendieta promovido de responsable a **admin** mediante `app_set_member` autenticado; cuenta activa, alcance general de los cuatro puntos. Respaldo privado previo y verificación con la cuenta real. Se conservaron sin cambios pedidos, clientes, artículos, stock y movimientos durante la operación (31 pedidos, 175 clientes, 14 artículos al verificar).
- Cambios de interfaz Android/web: unidades totales por producto del día y punto; cobros reales de efectivo por rango inclusivo y punto, con detalle y exportación Excel. No requiere migraciones ni nuevos movimientos de negocio.
- APK **1.7.0 / código 10**, paquete y firma conservados. SHA-256 `92030896c5e7ea330eb40374ac76c3f152832402de6083c970e69d6831a4ba04`. Actualización `adb install -r` sobre 1.6.0 y arranque sin Metro correctos; sin ingreso ni datos de prueba en producción.
- Web publicada en **https://kalak-logistica.vercel.app**, deployment `dpl_8K6KtbbFWAxCoG52yMbo132uFtBM`, estado **Ready**. Fuente del workspace sin commits (repositorio aún sin primer commit); no se modificó configuración de Auth/backend.
- Verificación: 111 pruebas compartidas/nativas; 47 pruebas web iniciales y 23 afectadas tras ajustes finales; TypeScript y builds correctos. 53 comprobaciones independientes sobre copia de datos reales, sin diferencias. Componentes nuevos comprobados en navegador con datos ficticios, escritorio y móvil 390 px sin desbordamiento; la sesión real de Mendieta se comprobó por Auth/RPC, no por ingreso en navegador.
- Evidencia redactada en `artifacts/evidence/release-1.7.0/`. Respaldos y credenciales fuera del repositorio. Advertencias no bloqueantes existentes: bundle principal web >500 kB y APIs/ajustes nativos de Expo/Gradle; sin fallos de compilación ni errores frescos de ejecución Android.

---

# KALAK 1.6.0: bolsas de primera compra y pedidos editables — 28/10/2026

Proyecto `bgkrxrvteedjfananabb` actualizado con `20261028160000_first_purchase_gifts_editable_orders.sql`, tras revisar el dry-run y validar un respaldo PostgreSQL custom de 414.423 bytes y 482 entradas, SHA-256 `bc527090ad3b8a533c483dfa538bcdb978c912be4a2c1103661f15f336613714`. Respaldo y credenciales privados fuera del repositorio.

Verificación HTTPS autenticada: se conservan **27 pedidos, 173 clientes y 14 artículos**, con sus cantidades, precios, importes, notas y estados originales. Stock y movimientos financieros idénticos antes/después de la migración. La Bolsa de tela existente queda habilitada para el beneficio, sin convertir automáticamente compras históricas en regalos. El servidor ofrece los marcadores `first_purchase_gifts` y `editable_delivered_orders`, además de elegibilidad global calculada por cliente. Se verificó también el alcance de Mendieta y el bloqueo de exportación administrativa.

No se crearon pedidos, clientes, stock ni cobros de prueba en la nube. Los escenarios de regalo, segunda compra, edición entregada, diferencias de stock y reintegros se probaron mediante UI real contra un backend local descartable y mediante SQL aislado. Evidencias en `artifacts/evidence/release-1.6.0/`.

---

# KALAK 1.5.0: pedidos y producción prevista — 28/10/2026

Proyecto `bgkrxrvteedjfananabb` actualizado con `20261026150000_planned_order_payment_method.sql` y `20261028120000_production_planning_sales.sql`, después de revisar el dry-run y verificar un respaldo PostgreSQL custom (370.195 bytes, 464 entradas, SHA-256 `0073da4d2d0357a0b5b2e9acde7ea4f555cd1e7f8c805aca215b0692edf62ce1`). El respaldo y las credenciales permanecen privados fuera del repositorio.

La verificación HTTPS autenticada confirmó que se conservan los **27 pedidos, 173 clientes y 14 artículos**, con fechas, cantidades, precios, importes, notas y preparación originales. No se cargaron ventas, clientes, previsiones ni stock de prueba en el servidor real. La prueba de usuario responsable confirmó alcance de Mendieta, previsiones globales ocultas y rechazo de exportación/planificación administrativa. Evidencia: `artifacts/evidence/release-1.5.0/cloud-verification.json`.

Cuenta **Mendieta** creada en Auth, habilitada como `responsable` en `mendieta` y comprobada con contraseña real. Sus credenciales están en el archivo privado `~/.local/share/pedidos-stock-tools/supabase/account-mendieta.json`; no en la APK, repositorio ni logs.

---

# KALAK 1.2.0: servidor activado — 24/10/2026

Proyecto actualizado: `bgkrxrvteedjfananabb`, región `sa-east-1`, URL `https://bgkrxrvteedjfananabb.supabase.co`.

## Despliegue realizado

Se revisó el dry-run y se aplicaron las tres migraciones pendientes de negocio, calendario/pagos e identidad. La verificación real encontró que el esquema administrado `auth` no permite a `postgres` delegar USAGE al rol de negocio; se agregó y aplicó `20261024152000_hosted_auth_bridge.sql`.

El rol de negocio conserva NOINHERIT y NOBYPASSRLS. La identidad se obtiene de los claims verificados por PostgREST. Un puente privado, ejecutable solo por el backend, lee únicamente UUID, correo y metadatos visibles del usuario; nunca expone contraseñas, hashes, identidades ni sesiones. No se otorgó al backend membresía de `authenticated` ni de `service_role`.

Migraciones verificadas en el servidor:

1. `20261023011529_initial_business_backend.sql`
2. `20261023012549_cent_precision.sql`
3. `20261023120000_business_expansion.sql`
4. `20261023150000_payments_pickup_calendar.sql`
5. `20261023180000_kalak_identity_sales.sql`
6. `20261024152000_hosted_auth_bridge.sql`

## Datos y acceso verificados

- Se conservaron los **2 clientes, 4 pedidos, 4 líneas y 8 artículos originales**, con cantidades, totales y precios históricos idénticos. No se crearon ventas ni movimientos de stock de prueba en producción.
- Se creó la primera cuenta administradora mediante Supabase Auth Admin, confirmada sin envío de correo, y se habilitó su membresía de administración.
- El ingreso por contraseña real funciona y `app_snapshot()` devuelve el perfil de administradora.
- Los RPC y las tablas operativas rechazan el acceso anónimo. `scripts/test-cloud-smoke.mjs` aprobó las comprobaciones remotas de seguridad y alcance con una sesión real.
- La exportación autenticada completa funciona; se guardó una copia posterior a la activación.
- Se verificó además el ingreso de esa misma cuenta en la **APK Android 1.2.0 real**, instalada en el emulador API 36 contra el endpoint HTTPS de producción: mostró la agenda y el perfil de administradora. La sesión de prueba se cerró; no se dejaron credenciales dentro de la APK.
- La APK 1.2.0 ya incorpora este mismo endpoint. No hace falta recompilar por esta corrección de permisos del servidor; la APK entregada conserva su hash y la firma original.

## Copias de seguridad y credenciales

Antes de migrar se generó un archivo PostgreSQL custom con los esquemas `public`, `app_private`, `auth` y `supabase_migrations`; `pg_restore --list` verificó 368 entradas y las tablas esenciales. La copia previa tiene **174.199 bytes**, SHA-256 `fc962cca7a4680f921c9f88234f7b0b38c44f8842cbcbc501a23c3e09715b97b`.

Los respaldos y el resultado del despliegue se guardan con permisos privados fuera del repositorio, en `~/.local/share/pedidos-stock-tools/supabase/backups/`. La contraseña de la administradora se entrega directamente al propietario; no se incluye aquí, en la APK ni en archivos versionados. La cuenta inicial utiliza un alias interno, no un buzón de correo para recuperación.

Las versiones antiguas ya no pueden operar sin cuenta. Distribuir la APK 1.2.0 como actualización, sin desinstalar. Consultar [Android](ANDROID.md) y [contrato actual](KALAK.md).

## Registro histórico previo (no describe el estado actual)

The following is a historical deployment record, **not a description of the new application access policy**.

# Hosted backend deployment

## App 1.1.0: pending remote rollout

The new `20261023120000_business_expansion.sql` migration has been verified and applied **only locally** in this change. The hosted project described below still has the previously deployed schema until a deliberate rollout. Back up hosted data first, review `supabase db push --linked --dry-run`, apply the additive migration, then distribute app 1.1.0/versionCode 2. Do not run the old initially-empty-project cloud smoke test after the seven-product seed or real business use. The new app detects schema_version mismatch and requests the migration instead of writing unsupported fields.

Local verification now includes all SQL suites, independent-connection API races and Realtime, isolated historical upgrade, and full JSON recovery drills. See VERIFICATION.md and RECOVERY.md. The existing public anonymous access policy must be changed before using private client information. No remote database was altered by this implementation.

## Previously deployed version 1.0.0

Verified 2026-10-23 UTC.

| Setting | Value |
| --- | --- |
| Project | `bgkrxrvteedjfananabb` |
| Public backend URL | https://bgkrxrvteedjfananabb.supabase.co |
| Region | `sa-east-1` |
| Workspace | Pedidos & Stock, isolated project |

The public publishable configuration is stored locally in the ignored `.env.cloud` file. No database password, management token, secret key or service-role key is included in this document. The application uses the publishable key only; Auth/sign-in is intentionally not required.

After local browser E2E finished, the final `.env` was switched to the same hosted configuration for the production APK. An independent anonymous cloud Realtime subscription to `workspace_events` also reached `SUBSCRIBED` successfully. Local development containers were stopped with their volumes preserved after verification; unrelated Docker services were not stopped.

## Deployed migrations

Reviewed `supabase db push --linked --dry-run`, then applied these migrations to the allowlisted project:

1. `20261023011529_initial_business_backend.sql`
2. `20261023012549_cent_precision.sql`

The deployed migration versions were checked against `supabase_migrations.schema_migrations`. No other Supabase project was modified. The existing local `.env` and local browser workspace were not replaced or reset during cloud deployment.

## Actual verification

Local verification before deployment:

- **32 pgTAP assertions passed** using `npx supabase test db`.
- **11 API integration scenarios passed**, including real independent-connection races, rollback, reservation reallocation, historical snapshots, restricted grants and anonymous realtime websocket invalidation.

Hosted verification using `node scripts/test-cloud-smoke.mjs`:

- Anonymous HTTPS `app_snapshot()` succeeds with exactly the four fixed locations.
- Direct anonymous table INSERT is denied; internal helper RPC is unavailable; invalid public commands return `VALIDATION_ERROR`.
- A single remote SQL transaction switched to `SET LOCAL ROLE anon` and successfully exercised client/catalog creation, immutable recipe creation, optional-supplier purchase, receipt with identical retry, unit conversion, production ingredient consumption on start, finished output, outlet-specific stock shortage denial, transfer, reservation reallocation and complete delivery.
- Assertions checked cents-rounded purchase totals, string-encoded order money, exact ingredient and finished-goods balances, ledger event count, and exactly one workspace revision increment per successful new command.
- The complete successful supply-chain transaction was **rolled back**. A final independent public HTTPS snapshot confirmed **four locations and zero clients, items, recipes, orders, purchases, productions or movements**.

## Re-running verification

`scripts/test-cloud-smoke.mjs` is deliberately restricted to this project reference and refuses a non-empty workspace before creating test data. It uses `.env.cloud` for public HTTPS checks and the locally stored administrator credential metadata for a transaction-scoped SQL connection. It never logs credentials. It requires `psql` (or `PSQL_BIN`) and never commits its successful fixture operations.

Do not run this initially-empty-project smoke test after real business data has been entered; its empty-workspace guard will reject that use. The normal local test runner continues to reject remote URLs.
