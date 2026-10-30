# Acceso y dependencias

## Modelo de acceso

La versión KALAK utiliza Supabase Auth con cuentas personales y RPC validados en servidor. La clave publicable identifica el proyecto, no autoriza a una persona. `app_members` asigna administradora o responsable de un único punto; la migración `20261023180000_kalak_identity_sales.sql` revoca el acceso anónimo y el acceso directo a tablas. Los actores se obtienen de `auth.uid()`, nunca del payload.

Los snapshots de negocio no se persisten en disco y cada cuenta tiene su propia caché en memoria. Cerrar sesión desmonta el espacio anterior. Las sesiones de Auth se conservan mediante el almacenamiento de la plataforma y se renuevan con Supabase. No se incorporan claves service-role a la app. Las cuentas pendientes no acceden a datos hasta la aprobación de una administradora.

El bootstrap inicial requiere un entorno servidor/SQL Editor confiable y solo puede ejecutarse una vez. Consultar [puesta en marcha](../README.md) y [contrato actual](KALAK.md).

Las claves de firma Android se guardan fuera del proyecto con permisos restrictivos. `.env`, keystores y artefactos de compilación no se versionan.

## Antecedente histórico: ampliación 1.1.0 (reemplazado por Auth KALAK)

La migración de negocio conserva la política pública anterior: nuevos contactos, mascotas, caja, exportación y auditoría también están disponibles a quien tenga acceso al endpoint. Esto no es control de acceso por empleado. La identidad `actor_id` es nula para operaciones anónimas. No desplegar datos privados bajo esta política sin acordar autenticación y autorización.

El respaldo completo incluye datos personales, historial e identificadores de reintentos. Los archivos y credenciales de recuperación deben mantenerse fuera de carpetas públicas. SHA-256 detecta corrupción; no autentica al emisor de un respaldo ni reemplaza la protección de acceso.

La instalación de los módulos nativos de exportación volvió a informar las mismas 19 alertas altas heredadas; no se aplicó una degradación forzada del stack. El detalle histórico se conserva a continuación.

## Auditoría npm — 22 de octubre de 2026

`npm audit` identifica 19 entradas de gravedad alta que se propagan desde dos dependencias de las herramientas Metro/Expo:

- `braces` hasta 3.0.3: agotamiento de pila ante patrones anidados. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- `node-forge` hasta 1.4.0: verificación RSA PKCS#1 v1.5. [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

En la fecha de la revisión esas son las últimas versiones publicadas en npm; no existe una actualización corregida compatible que pueda instalarse. Las entradas restantes son dependientes transitivos del bundler y la CLI. `npm audit fix --force` propone degradar Expo a 44 y React Native a 0.72, lo cual rompe este proyecto; no se aplica.

Estos avisos no deben ocultarse ni interpretarse como una auditoría de seguridad integral de la APK. El proyecto no procesa patrones de glob ni certificados RSA aportados por usuarios. La APK release incluye el bundle estático y no necesita servir Metro en producción. Revisar nuevamente los avisos antes de futuras compilaciones y actualizar cuando las correcciones estén publicadas.
