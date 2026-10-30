# Actualización web 1.8.0 — 30/10/2026

**Producción:** https://kalak-logistica.vercel.app · deployment `dpl_Lf3LpHU4et2g89PP2t3HS7UhZo3q` · **Ready**, promovido tras verificar el despliegue protegido. Rutas principales HTTP 200 y backend operativo correcto. Fuente del workspace, sin commits ni cambios de dominio/Auth. Ver [cambios, evidencia y límites de 1.8.0](RELEASE-1.8.0.md).

---

# Actualización web 1.7.0 — 29/10/2026

**Producción:** https://kalak-logistica.vercel.app · deployment `dpl_8K6KtbbFWAxCoG52yMbo132uFtBM` · **Ready**.

Publicado en el mismo proyecto/equipo desde los archivos del workspace, sin primer commit ni integración Git. El conector MCP no tenía acceso al equipo; se usó la sesión CLI existente, confirmada como `morguimateos-projects/kalak-logistica`. No se cambiaron variables, dominios, Auth ni migraciones.

- Ventas muestra unidades de todos los pedidos válidos del día por producto y punto (pendientes + entregados, con o sin pago; excluye cancelados/devueltos). El total diario solo responde al día y punto; la preparación pendiente filtrada permanece separada.
- Resumen agrega **Cobros reales en efectivo**, fechas desde/hasta inclusivas y selector de punto junto a la sección, sincronizado con el filtro general. Usa movimientos reales firmados (cobros, reintegros y reversiones), no medios previstos ni deudas/transferencias/egresos. Excel conserva el período y punto elegidos.
- Mendieta ya es administrador en el servidor, habilitando inventario inicial, ajustes y transferencias de stock. No requiere cuenta nueva.
- Typecheck/build aprobados; 47 pruebas web y 23 afectadas tras revisión final. Verificación visual de componentes reales con datos ficticios en escritorio y 390 px; tablas con scroll interno, ancho de página 390 px. El acceso autenticado real se verificó por API, no mediante una sesión productiva en navegador.
- La advertencia existente de bundle principal >500 kB no bloquea la compilación; instalación remota auditada sin vulnerabilidades. Evidencia: `artifacts/evidence/release-1.7.0/`.

---

# Despliegue web — 28/10/2026

## Producción

- URL pública: **https://kalak-logistica.vercel.app**
- Plataforma: Vercel; equipo `morguimateos-projects`, cuenta autenticada `morguimateo`.
- Proyecto separado: `kalak-logistica` (`prj_yc9sM1Wn6Gyn1Rrj1rtNH0h8wMjZ`). No se reemplazaron los otros sitios KALAK.
- Deployment publicado/promovido: `dpl_DcAvfkvnJK3U9v58GWbeCDhXnd5E`.
- Estado confirmado: **Ready**, target `production`, Node 24.x.
- Build remoto: `npm ci --prefix web` → `npm --prefix web run build` → `web/dist`.
- Origen: archivos del workspace, sin integración Git remota ni commit publicado. El identificador de deployment identifica la versión publicada.
- Solo se configuraron `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en producción. No se publicaron credenciales privadas, claves de servicio, cuentas de prueba ni los datos del entorno descartable.

Las URLs inmutables y la alternativa con nombre de equipo mantienen la protección de Vercel. El dominio público anterior es el punto de entrada de la aplicación, que requiere además su propia cuenta personal de Supabase.

## Correcciones de despliegue

El primer build remoto detectó que Vite heredaba `expo/tsconfig.base` al transformar módulos compartidos fuera de `web/`. Se fijó explícitamente la configuración web en Vite y Vitest, sin instalar Expo ni cambiar Android. La reproducción aislada posterior **incluyó el tsconfig de la raíz**, sin dependencias instaladas en la raíz: build, TypeScript y las 43 pruebas web pasaron.

También se actualizaron Vitest y su dependencia de mocks al parche compatible 4.1.12. Auditoría npm web completa y de dependencias de producción: **0 vulnerabilidades**.

`.vercelignore` excluye archivos de entorno, dependencias locales, artefactos Android, scripts/backend, datos y pruebas del paquete de publicación.

## Supabase Auth

Se revisó el diff y se aplicaron **únicamente** estas dos propiedades en la instancia compartida `pedidos-stock`:

- `auth.site_url`: `https://kalak-logistica.vercel.app` (antes `http://localhost:3000`).
- `auth.additional_redirect_urls`: `https://kalak-logistica.vercel.app` (antes vacío).

La verificación posterior confirmó que no quedaban diferencias en esas propiedades. Se conservaron las confirmaciones de correo, MFA, límites y demás configuraciones remotas; no se ejecutaron migraciones ni se modificaron pedidos, clientes, pagos o stock operativos.

## Evidencia de verificación

| Comprobación | Resultado |
| --- | --- |
| Build real de Vercel | Ready; instalación web independiente y compilación exitosas. |
| HTTPS público y rutas `/`, `/clientes`, `/stock`, `/resumen`, `/ajustes` | HTTP 200; SPA correcta y cabeceras `nosniff`/`DENY`. |
| Bundle publicado | Apunta a la instancia Supabase operativa, no al entorno descartable; assets con caché inmutable. |
| Navegador en el dominio público | Acceso configurado y controles de ingreso disponibles, sin errores de consola del dominio. |
| Seguridad anónima de Supabase compartido | RPCs operativos y lecturas directas rechazados; no se escribió información de negocio. |
| Autenticación real de prueba | Supabase Auth → JWT firmado → PostgREST → SQL migrado → web; sin mocks de RPC. |
| Entregar desde la interfaz | Pedido entregado por cobrar, sin pago creado; stock físico 18 kg y reserva liberada. |
| Cobrar después desde la interfaz | Un único cobro de ARS 18.750 en efectivo; sin nuevo descuento de stock. |
| Crear cliente y mascota desde la interfaz | Persistencia SQL comprobada, especie y peso `12,5` normalizado a 12.5 kg. |
| Ajustar stock desde la interfaz | Suma única de 2,5 kg y movimiento trazable; físico 20,5 kg. |
| Exportar Excel y respaldo JSON desde la interfaz | Descargas generadas; contrato de respaldo completo confirmado por RPC autenticado. |
| Rol responsable real | Snapshot limitado a Mendieta, sin lista de usuarios; respaldo completo denegado por el servidor. |
| Cambio de rol con interfaz abierta | Actualizar redirige de Ajustes a Ventas y oculta Resumen/Ajustes. |
| Móvil autenticado | 390 px de viewport y contenido, sin desbordamiento horizontal. |

Las escrituras de estas pruebas se realizaron **solo en una base local descartable** `kalak_preview_*`, con identidad temporal y PostgREST independientes. La instancia operativa no se usó para crear ventas ni movimientos de prueba. El gateway de prueba no implementa Realtime; allí se verificó la actualización por refetch de los comandos, no los WebSockets compartidos.

Al terminar se eliminaron la identidad temporal, la base descartable, su contenedor PostgREST y su configuración privada; se comprobó que el contenedor y la base de prueba ya no existían. Se conservó la infraestructura local preexistente y los archivos de entorno de la aplicación.

### Límite de aceptación

No se inició sesión en la cuenta productiva personal del usuario: no se proporcionó una sesión habilitada en el navegador. La petición de ingreso quedó enviada, sin solicitar contraseñas por chat. Esto no se presenta como verificación de una cuenta productiva: se verificaron los flujos autenticados con servicios reales en el entorno aislado y la disponibilidad/configuración del sitio publicado. La comprobación de esa cuenta específica continúa requiriendo su ingreso.
