# Actualizar una instalación

La base compartida no se actualiza automáticamente. Antes de desplegar, generar un respaldo y revisar las migraciones pendientes. Aplicar en orden todas las migraciones de `supabase/migrations`; las migraciones aditivas conservan ventas, stock y cobros históricos. La APK debe recompilarse después de migrar la base para incorporar los cambios.

## Puesta en marcha

1. Habilitar Supabase Auth por correo y contraseña y configurar las URLs/correos de confirmación.
2. Crear la primera cuenta personal. Desde un entorno servidor de confianza o el SQL Editor de Supabase, ejecutar una vez con el UUID real:

   ```sql
   select public.app_bootstrap_admin('UUID-DE-LA-CUENTA'::uuid, 'Nombre administradora');
   ```

3. Ingresar con esa cuenta. La administradora puede habilitar las demás cuentas y asignarles un punto en **Ajustes → Usuarios internos**.
4. Revisar catálogo, unidad comercial y contenido por envase con los datos de la instalación. No se convierte automáticamente el stock histórico de unidades a kg.
5. Cargar inventario inicial por ubicación o conservar saldos existentes. La carga inicial suma unidades; no repetirla sobre un saldo ya cargado.
6. Cargar pedidos y ventas desde **Ventas**. No se requiere Nooty ni importación histórica.

Las cuentas sin asignación no acceden a datos. El respaldo de negocio no reemplaza una copia de Supabase Auth; consultar [recuperación](RECOVERY.md). Sin conexión, las consultas se limitan a la sesión actual en memoria.
