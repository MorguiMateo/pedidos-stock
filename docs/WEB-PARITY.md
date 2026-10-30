# Paridad de KALAK web con Android 1.6.0

La web está implementada con React DOM, TypeScript, Tailwind CSS y Vite en `web/`. No es un envoltorio de React Native. Conserva el backend Supabase, sus reglas transaccionales, los contratos de comandos y las utilidades de cálculo compartidas con Android.

## Cobertura implementada

| Módulo | Funcionalidades trasladadas |
| --- | --- |
| Acceso personal | Ingreso, solicitud de cuenta, confirmación por correo, espera de habilitación, sesión persistente, cierre de sesión y errores comprensibles. |
| Roles | Administradora general; responsable limitada al punto asignado. Resumen/Ajustes restringidos también al acceder por URL. Autorización real en Supabase. |
| Calendario | Primera vista de ventas; día/semana/mes, hoy, navegación por fecha y filtros por punto, cliente, producto, entrega y pago. |
| Pedidos | Varios productos, unidades/kg, cliente existente o alta rápida, precio por fecha, notas, horario, Uber, bultos y preparación, control de stock y confirmación de faltantes. |
| Edición | Pendientes y entregados, versiones de concurrencia, precios históricos, stock por diferencia y sin duplicación de cobros. |
| Regalos | Bolsas de primera compra, elegibilidad por cliente, reserva/stock y acompañamiento de una compra con cargo. |
| Venta espontánea | Cliente opcional, independiente o anexada a pedido pendiente del mismo cliente/punto, entrega/cobro conjuntos y stock físico sin consumir otras reservas. |
| Entrega y pago | Estados separados, entregado por cobrar, efectivo/transferencia/gratis, nombre de transferencia, medio previsto sin pago, corrección mediante contramovimientos y saldos parciales históricos. |
| Controles del pedido | Reprogramación, preparación, cancelación, borrado confirmado, devolución, reintegro y reposición cuando corresponden al contrato existente. |
| Avisos | Nuevos pedidos con retiro hoy identificados por color del punto; abre la operación, sin anunciar retiros futuros ni pedidos ya conocidos. |
| Puntos/agenda | Cierre y reapertura por fecha, motivo y reprogramación de pedidos existentes antes del cierre. |
| Clientes | Alta/edición, búsqueda por datos y mascotas, teléfono único, dirección/notas, perro/gato/peso/dieta, punto preferido, historial y detalle, seguimiento y recompra. |
| Stock | Existencias físicas, utilizables, reservadas, libres y faltantes por ubicación; inventario inicial aditivo, ajustes, transferencias con motivo, historial y reversión trazable. |
| Cocina central | Previsión futura sin recetas ni stock físico, reservas futuras, necesidades por punto, fechas, cancelación y conciliación con producción real/ingresos vinculados. |
| Catálogo | Categoría, código, presentación, unidad, contenido por envase, peso, cálculo de envases, mínimo, elegibilidad de regalo, precios con vigencia y desactivación preservando historial. |
| Administración | Puntos/colores, usuarios internos, rol/punto/estado activo y auditoría de cambios con antes/después. |
| Informes | Ventas mensuales/diarias, pedidos vs clientes únicos, productos, preparación/bultos por punto, seguimiento/recompra, pendientes de cobro, caja por medio, stock y movimientos. |
| Finanzas | Egresos, conciliación, reversiones con motivo, caja por fecha efectiva de movimiento y distinción entre venta, entrega y cobro. |
| Exportaciones | Excel `.xlsx` real compartiendo el generador de Android, CSV y respaldo completo desde el servidor con integridad SHA-256; descarga nativa del navegador. |
| Sincronización | Cada minuto en primer plano, reconexión/foco, novedades compartidas y actualización manual. Consulta sin conexión limitada a la instantánea en memoria de la cuenta actual. |
| Fiabilidad | Comandos idempotentes, versiones esperadas, exclusión de escrituras simultáneas, mensajes de dominio, validación de capacidades del backend y descarte del caché al cambiar de cuenta. |

### Alcance histórico

Compras/proveedores, materias primas y fabricación por recetas no se exponen: tampoco forman parte de los módulos operativos actuales de la APK. Sus datos e historiales no se borran. No se agrega borrado de clientes porque la versión Android y el backend no ofrecen esa operación.

## Comprobaciones

Pruebas de integración web con DOM y RPC simulados, sin tocar la base operativa:

- Pedidos multirrenglón y regalos, cobro/entrega separados, saldos históricos, edición de entregados, confirmación de déficit, venta anexada y avisos nuevos.
- Ajustes, disponibilidad libre al transferir, motivos, conciliación de planes y permisos de stock/administración.
- Fichas y mascotas, normalización/duplicados, conservación del borrador y modo sin conexión.
- Cohortes de informes, importes históricos/gratis, clientes únicos, cobros netos, conciliación, egresos/reversiones y descargas reales.
- Acceso, solicitud de cuentas, rutas directas y restricciones de responsables, espera de habilitación y cierre de sesión.
- Proveedor de datos: versión/UUID, bloqueo offline, exclusión de escrituras, cambio de cuenta, revocación de permisos y validación de respaldos.

La suite compartida de Android verifica los cálculos de negocio reutilizados. TypeScript y el build de producción se comprueban por separado para Android y web.

Resultado al 28/10/2026: **43 pruebas web y 99 pruebas compartidas aprobadas**, TypeScript de ambas aplicaciones aprobado y build Vite aprobado. También se compiló una copia aislada con únicamente las dependencias web, sin `node_modules` de la raíz ni archivos de entorno, para comprobar el aislamiento del build previsto para Vercel. En navegador se revisó el acceso y la solicitud de cuenta a 1440 px y 390 px, sin desbordamiento horizontal en móvil.

El navegador integrado permite comprobar acceso, solicitud de cuenta y diseño responsive sin modificar datos. Se verificaron además entrega, cobro posterior, cliente/mascota, stock, exportaciones y permisos mediante autenticación real contra una base descartable. **La aceptación de una cuenta productiva específica sigue requiriendo su ingreso; las pruebas simuladas o aisladas no se presentan como esa aceptación.** No se agregan credenciales de prueba ni bypasses de autenticación al producto. Ver [evidencia del despliegue](WEB-DEPLOYMENT.md).

## Despliegue

Producción: **https://kalak-logistica.vercel.app**. Ver [KALAK web](../web/README.md#vercel) y [registro de despliegue](WEB-DEPLOYMENT.md).
