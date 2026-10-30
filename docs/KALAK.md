# Contrato operativo KALAK

## Identidad y acceso

Supabase Auth identifica a cada persona; `app_members` asigna rol y punto. La app no acepta un `actor_id` enviado por el cliente: las operaciones se atribuyen a `auth.uid()`. Los responsables consultan pedidos, clientes asociados y stock de su punto y no administran catálogo, inventario global ni permisos. Las cuentas pendientes o desactivadas no pueden usar los RPC de negocio. Las tablas no son accesibles directamente al cliente; las validaciones y el alcance se aplican en el servidor, no solo en los botones.

El alta inicial de administradora se hace una vez desde un entorno confiable. Las nuevas cuentas solicitan acceso y la administradora las aprueba desde Ajustes. No hay contraseña compartida ni clave privilegiada en el frontend.

## Productos, cantidades y precios

- Cantidad de venta y stock usan la **unidad comercial**: kg o unidad. Kg admite fracciones; unidad exige enteros.
- `presentation` describe el envase. `package_size` expresa cuánta cantidad comercial contiene cada envase: 0,5 kg por envase implica dos envases para un kg. El cálculo redondea hacia arriba cuando corresponde preparar un último envase incompleto.
- Cada línea guarda nombre, unidad, contenido por envase y precio históricos. Los cambios del catálogo no reescriben pedidos existentes.
- `product_prices` conserva precios con fecha de vigencia. El precio de una venta nueva es el vigente al registrarla, no el de la futura fecha de retiro. Una vigencia futura no cambia anticipadamente el precio actual.
- Productos inactivos conservan todas sus referencias históricas y no están disponibles para nuevas líneas.
- Las unidades ya usadas no se reinterpretan automáticamente. La conversión de un catálogo histórico exige reconciliación explícita del negocio.

## Pedidos y ventas espontáneas

Un pedido programado requiere cliente y fecha de retiro. La venta espontánea permite cliente nulo, usa siempre el día real de Mendoza y queda entregada al guardarse. Una persona responsable no puede elegir un punto ajeno.

Fechas distintas: creación, retiro programado, entrega efectiva y confirmación de cobro. No se utiliza una fecha como sustituto de las otras.

La operación se guarda atómicamente con identificador de comando y control de versión. Repetir el mismo comando devuelve su resultado sin duplicar stock o cobros. Un resultado vacío o incierto no se presenta como guardado exitoso; el formulario se conserva y se puede verificar/reintentar la misma operación.

## Stock

| Concepto | Significado |
| --- | --- |
| Físico | Existencia registrada por movimientos en cada ubicación, incluidos los lotes vencidos aún no ajustados. |
| Apto | Existencia de lotes no vencidos que el servidor puede entregar. |
| Reservado | Cantidad apta asignada a pedidos pendientes. Los pedidos confirmados con faltantes no desplazan reservas ya comprometidas; el resto se prioriza por retiro y antigüedad. |
| Encargado del día | Cantidad de pedidos pendientes con esa fecha de retiro, por producto y punto. |
| Disponible para nuevos pedidos | Stock apto menos compromisos pendientes de todas las fechas, limitado a cero. No proyecta compras o producción futuras. |
| Faltante | Cantidades comprometidas todavía sin existencia apta suficiente. |

Crear un pedido reserva pero **no descuenta físico**. Entregar descuenta una sola vez en el punto asignado. La venta espontánea descuenta al confirmar y no puede consumir reservas de otros pedidos; no tiene opción de sobreventa.

Un pedido de hoy con stock insuficiente requiere confirmación explícita `allow_stock_shortage`; se permite agendarlo con faltante, pero no entregarlo hasta completar su reserva. Los pedidos futuros pueden registrarse con faltantes sin el cartel de hoy. El servidor comprueba nuevamente el stock al guardar, dentro de la transacción. El pedido confirmado con faltantes recibe menor prioridad hasta completar su reserva; al ingresar stock suficiente se normaliza automáticamente, sin apropiarse de reservas anteriores.

Inventario inicial y ajustes suman o restan movimientos con motivo; no sobrescriben el historial. Las transferencias conservan origen/destino y no trasladan unidades reservadas. Los mínimos se revisan por producto/ubicación, no sumando saldos que podrían esconder faltantes en otro punto.

## Entrega, preparación y pago

Los bultos preparados diferencian pendiente de preparación y preparado para entregar. La entrega permite confirmar el pago final o cerrar **entregado / Por pagar**. Efectivo y Transferencia son los medios de cobro; no se crean nuevos pagos parciales. Los parciales históricos siguen computándose y el siguiente cobro cancela el saldo completo restante. Si se amplía un pedido pendiente ya cobrado, se conserva el cobro anterior y la diferencia queda Por pagar, sin generar un nuevo cobro parcial.

Entrega y cobro registran hora y usuario por separado. La edición de un pedido entregado no reescribe sus movimientos: se utiliza devolución con motivo y, cuando corresponda, reintegro de stock/dinero. Cancelar un pendiente libera reservas; los pedidos con cobros requieren revertir/reintegrar el cobro antes de cancelarlos. Las operaciones relevantes conservan auditoría con antes/después.

## Calendario y avisos

El calendario ofrece día/semana/mes y filtros. Los totales de preparación muestran pendientes, no entregados. La disponibilidad operativa no se calcula sobre una lista filtrada de clientes que ocultaría compromisos ajenos.

Los avisos de nuevos pedidos usan el color del punto y abren el pedido exacto, limpiando filtros incompatibles. Se detectan después de la carga inicial de la sesión; requieren creación y retiro en el día corriente de Mendoza. No son notificaciones push ni funcionan con la app cerrada. Se actualizan por Realtime y consulta periódica mientras la app está activa.

## Informes

Los informes salen de los registros operativos y se actualizan al sincronizar un cambio. Ventas y preparación usan retiro como cohorte operativa; los cobros usan fecha real del movimiento. Se excluyen pedidos cancelados y devueltos de ventas. Cantidad de pedidos y clientes únicos son métricas diferentes; una venta anónima cuenta como operación, no inventa un cliente.

El seguimiento distingue alta de cliente, primera compra efectiva, última compra y días transcurridos. El umbral de recompra es configurable y se muestra, sin desactivar automáticamente a la persona. Las hojas de Excel incluyen etiquetas y criterios de cada informe; los valores de texto se exportan como texto inerte.

## Alcance y puesta en marcha

No se desarrollan nuevos flujos de compras, proveedores, materias primas, insumos, costos ni producción. Las estructuras históricas se mantienen para una futura ampliación segura. No se requiere integración con Nooty para cargar o entregar pedidos.

La implementación local no equivale a un despliegue remoto: se necesitan migraciones, configuración Auth, primera administradora y nueva compilación antes del uso productivo.
