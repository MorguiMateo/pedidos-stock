# Respaldo, recuperación y salida del proveedor

## Actualización KALAK

El respaldo de negocio ahora incluye miembros/permisos, precios fechados, envases y auditoría antes/después. La exportación completa requiere una sesión de administradora. El script de consola requiere `SUPABASE_USER_ACCESS_TOKEN` en el entorno (JWT de administradora); no pegar ese token en registros ni en archivos versionados.

**Supabase Auth se respalda por separado:** las cuentas deben existir con sus UUID originales antes de restaurar sus asignaciones. El JSON de negocio no incluye contraseñas, sesiones ni credenciales de acceso y no reemplaza una copia de la infraestructura Auth. El restaurador rechaza referencias faltantes y solo admite una base local vacía. Los campos generados, como el teléfono normalizado, se recalculan, no se insertan.

Excel `.xlsx` permite analizar los informes; no sustituye el JSON de recuperación. El código conserva compatibilidad con respaldos anteriores, que no contienen miembros ni precios fechados.

## Qué se exporta

**Resumen → Respaldo completo JSON** consulta `app_export()` en el servidor, no una caché local. Contiene versión de formato, fecha de exportación, snapshot de consulta, tablas originales con UUID y referencias, precios aplicados a las ventas, recetas aprobadas, consumos reales, movimientos de stock, lotes y sus asignaciones, caja, auditoría e identificadores de operaciones idempotentes. Los decimales se conservan como texto para evitar pérdida de precisión.

En la web se descarga un `.json`. En Android se comparte un **archivo**, que puede guardarse en una carpeta o enviarse a un destino elegido por la persona. El JSON generado por la app incorpora SHA-256 para detectar corrupción. Guardar la copia fuera del teléfono: una descarga que permanece solo en el mismo dispositivo no protege contra su pérdida.

**Exportar CSV** sirve para planillas: separador `;`, UTF-8 con BOM, comillas escapadas y neutralización de fórmulas. Incluye catálogo, pedidos/renglones, stock, movimientos, caja, compras y lotes. Es una vista de análisis, **no sustituye al respaldo JSON completo**. La exportación CSV usa el último snapshot sincronizado y muestra su fecha.

Alternativa por consola, con clave publicable y sesión de una administradora:

```sh
node scripts/backup-workspace.mjs --env .env --out artifacts/backups/mi-respaldo.json
```

Se generan el JSON y un archivo `.sha256` con el hash de sus bytes. El script no sobrescribe una copia existente. Los archivos contienen información comercial y de clientes; almacenarlos con acceso restringido. La comprobación SHA-256 detecta corrupción accidental, no sustituye una firma digital ni la custodia segura.

## Recuperar sin sobreescribir la operación actual

1. Conservar la copia original intacta y detener cambios durante el corte definitivo.
2. Crear una **base PostgreSQL local nueva**, nunca reutilizar la operativa.
3. Aplicar las migraciones del repositorio en orden. Para un proyecto Supabase nuevo, el CLI crea las extensiones, roles y tablas de infraestructura necesarias.
4. Configurar `RESTORE_DATABASE_URL` en el entorno del proceso con acceso administrativo a esa **base local vacía**. No pegar credenciales en registros ni guardar esta variable en la app.
5. Ejecutar:

```sh
node scripts/restore-workspace.mjs --file artifacts/backups/mi-respaldo.json --replace-initial-catalog
```

El script admite exclusivamente `localhost`, `127.0.0.1` o `::1`; rechaza destinos remotos, copias incompletas, hashes inválidos y bases que ya tengan clientes, pedidos, compras, recetas, producción, movimientos, auditoría u operaciones registradas. `--replace-initial-catalog` autoriza reemplazar solamente el catálogo y las ubicaciones iniciales de la base vacía, no mezclar datos de dos negocios.

La recuperación es una sola transacción. Reutiliza UUID y precios originales, evita ejecutar otra vez los movimientos/asignaciones al importar y verifica referencias y balances/reservas antes de confirmar. Un error revierte toda la restauración. No es una acción expuesta en la aplicación del día a día.

6. Comparar cantidades de registros, pedidos abiertos, precios históricos, existencias por producto/punto/lote y caja. Ejecutar las pruebas y abrir la copia restaurada en la app antes de cualquier corte.
7. Conservar una copia PostgreSQL completa, además del JSON, si se requiere recuperar también autenticación, almacenamiento externo u otros servicios fuera del esquema de negocio.

## Cambiar de proveedor

El formato JSON no depende de una sesión ni de identificadores exclusivos de la interfaz. `raw_tables` contiene relaciones explícitas y `schema_version: 2` identifica el contrato. Un nuevo proveedor puede importar las tablas a PostgreSQL u otro motor preservando UUID, referencias, cantidades decimales exactas y el orden del historial. El snapshot anidado facilita validar el resultado; los CSV permiten revisión independiente en planillas.

La configuración de infraestructura, claves, usuarios de Supabase Auth y archivos de Storage no forman parte del JSON de negocio. En esta app no se utilizan Auth ni archivos comerciales externos, pero una futura integración debe respaldarlos por separado.

Para migrar: restaurar y validar primero en un entorno separado; ensayar el corte, pausar escrituras, generar una copia final, importar, conciliar y recién entonces cambiar el backend de la app y recompilar. Mantener el proveedor anterior en consulta durante la validación. No alterar/eliminar el historial para corregir diferencias: usar movimientos de ajuste o reversión con motivo.

## Corregir errores operativos

- **Stock:** ajuste por diferencia con motivo o reversión de un ajuste/traslado que conserve stock libre y los lotes originales. No se edita directamente una existencia. La reversión crea un nuevo movimiento vinculado.
- **Caja:** reversión con motivo; no se borra ni se modifica el importe original. La conciliación tiene control de versión.
- **Pedido entregado:** devolución completa con motivo, decisión explícita de reincorporación física y eventual reintegro limitado al importe cobrado. Reincorporar conserva el lote; un lote vencido sigue vencido.
- **Receta:** nueva revisión aprobada; las órdenes anteriores conservan la versión y su copia original.

## Límites conocidos

El acceso compartido sigue siendo anónimo por la configuración previa del proyecto: la auditoría no prueba qué persona operó. La identidad y permisos del personal requieren una implementación de autenticación antes de almacenar información privada. Los respaldos y procedimientos no reemplazan esa protección.

La facturación electrónica no se simula: se integrará con el proveedor autorizado que el negocio seleccione. La recuperación no restaura comprobantes emitidos en ese servicio externo.

## Revisión de pagos y fechas de retiro

La exportación v2 incluye también `pickup_closures` y los nombres opcionales de transferencia de pedidos y movimientos financieros. La restauración rechaza un destino con cierres existentes. Los respaldos v2 anteriores sin la tabla de cierres ni nombres siguen siendo compatibles: se restauran con cero cierres y nombres nulos, sin modificar los importes históricos. El destino debe tener aplicada también `20261023150000_payments_pickup_calendar.sql`. El simulacro de recuperación verifica ambos formatos en bases locales aisladas.
