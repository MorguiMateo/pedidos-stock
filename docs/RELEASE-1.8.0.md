# KALAK 1.8.0 — 30/10/2026

## Entrega

- Web: https://kalak-logistica.vercel.app, deployment `dpl_Lf3LpHU4et2g89PP2t3HS7UhZo3q`, **Ready** y promovido al dominio público. Las cinco rutas principales devuelven HTTP 200 con los assets nuevos.
- Android: `artifacts/kalak-logistica-1.8.0.apk`, código **11**, paquete `com.pedidosstock.app`, firmado con el mismo certificado. Actualización sobre 1.7.0 mediante `adb install -r` y arranque sin Metro correctos; sin errores ReactNativeJS/AndroidRuntime. No se inició sesión productiva durante esta prueba Android.
- SHA-256 APK: `a6061c26d71c472ec849292922169e0e7d68cd86d9a4de34ae3acfe86a647ec5`.
- Se eliminaron las APK anteriores 1.6.0, 1.6.1 y 1.7.0, a pedido del usuario. Se conservan sus registros históricos, no sus binarios.

## Cambios en web y Android

- Inicio ordenado con fecha actual/día destacado, alta de pedido/venta, calendario, pedidos por punto, entregados por cobrar, no retirados, total por producto y administración de disponibilidad al final.
- Resúmenes verticales, fórmulas primero: **FP, FG, CC, VIN, SEM, K y BOL**. Se conserva kg cuando corresponde a la unidad comercial histórica; se omite «unidad».
- Entrega, entrega sin cobro y marcado de pago accesibles en pedidos compactos. Transferencia predeterminada y confirmación Sí/No antes de corregir un medio seleccionado. Las correcciones conservan el historial financiero.
- Alta completa de cliente desde el pedido; punto habitual o Mendieta por defecto; repetir productos/cantidades/punto del último pedido, con edición manual posterior.
- Mascotas con anotaciones, foto JPEG reducida y edad con fecha de referencia y cálculo de edad estimada. Cambiar otros datos no vuelve a fechar la misma edad.
- Domingos cerrados y sábados solo Mendieta, con excepciones manuales por punto/fecha, persistentes y con control de concurrencia. No se cancelan pedidos existentes.
- No retirados: pendientes a partir de las 20:45 de Mendoza y de fechas anteriores, con reprogramación/cancelación. Para cancelar un pedido cobrado primero debe registrarse el reintegro real; administración tiene acceso a ese flujo desde la sección.
- Finanzas: calendario mensual de pedidos por punto/día; productos entregados por punto y unidad, regalos separados; clientes únicos por ID y ticket promedio; gráficos de seis meses y estimación de consumo por promedio de tres meses completos.
- Equilibrio por producto con costos fijos asignados, costo variable y precio. Escenarios guardados **solo en el navegador o dispositivo actual**, no sincronizados. Los costos se ingresan manualmente; no se deducen de la caja ni se inventan.

## Base y verificación

Aplicadas únicamente `20261030120000_pet_profiles.sql` y `20261030130000_weekend_pickup_availability.sql`. Respaldo privado previo de esquema/datos, fuera del repositorio. Comparación autenticada antes/después: **37 pedidos, 177 clientes, 14 artículos y 35 movimientos financieros**, sin modificaciones en pedidos, clientes, artículos, stock, movimientos, producción, compras, recetas ni lotes. No se cargaron operaciones de prueba en producción.

- 129 pruebas compartidas/nativas y 58 web aprobadas; ambos TypeScript y builds correctos.
- Instalación limpia y actualización histórica aislada, suites SQL (167 aserciones vigentes), concurrencia/idempotencia, permisos y flujo de fines de semana aprobados. Las suites históricas de stock abren explícitamente sus fechas de prueba para que el cierre semanal no oculte sus aserciones.
- Navegador contra Auth/PostgREST/SQL reales descartables: alta de cliente/mascota, persistencia, calendario, clientes únicos, ticket, pronóstico y equilibrio. Tres meses de 1/2/3 kg producen estimación de 2 kg. Conversión real de imagen a JPEG de 640×640, con validación de tamaño/tipo.
- Móvil 390 px y escritorio 1440 px sin desbordamiento de página. Evidencias y capturas: `artifacts/evidence/release-1.8.0/`.
- Límite de automatización: el adaptador del navegador no pudo cambiar opciones nativas de select; repetir/punto habitual están cubiertos por pruebas de integración, no por ese recorrido manual automatizado. El selector nativo de fotos no se ejercitó. El gateway descartable no implementa Realtime; sus errores WebSocket esperados no son fallos de producción.

## Advertencias de dependencias

La instalación web remota informa **0 vulnerabilidades**. La auditoría del árbol Expo conserva **8 alertas heredadas (5 bajas y 3 altas)**, derivadas de `deepmerge`/configuración y `zod`/CLI. `node-forge` se actualizó a una versión corregida. No se aplicó la propuesta automática de degradar Expo de SDK 58 a 51; requeriría una migración incompatible ajena a esta entrega. Se conserva también la advertencia de bundle web principal mayor de 500 kB, sin impedir build ni publicación.
