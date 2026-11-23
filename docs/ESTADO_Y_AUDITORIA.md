# El Fogón · Estado actual y auditoría técnica

Auditoría del 23/11/2026 (actualizada al final de la sesión: ver estados «Corregido») sobre el commit `cdd4c72` (GitHub `RamiPCT/el-fogon-appp`, rama `main`), comprobado también contra la carpeta del ordenador del dueño (sin cambios de código posteriores; `npm run build` funciona en Windows).

La app se usa en producción desde hoy en la red local del restaurante. Cualquier cambio debe mantener compatibles los datos de `server/data/db.json`.

## 1. Qué hay hoy (resumen)

| Capa | Tecnología | Archivos principales |
| --- | --- | --- |
| Cliente | React 19 + Vite 8 + Tailwind 4, `lucide-react`, `qrcode`, `canvas-confetti` | `client/src/App.jsx` (rutas), `views/*`, `components/*`, `context/*`, `utils/*`, `i18n.jsx` |
| Servidor | Node ≥ 22.9, Express 5, Socket.IO 4 | `server/index.js` (rutas, sockets, tareas), `db.js`, `auth.js`, `printer.js`, `time.js` |
| Datos | Un archivo JSON en memoria, se reescribe entero en cada cambio (escritura atómica: `.tmp` + rename) | `server/data/db.json`, copias en `server/data/backups/`, fotos en `server/data/uploads/` |
| Pruebas | `node:test` sin dependencias (`npm test`, 15 pruebas) + pruebas de navegador fuera del repo | `tests/api.test.js` |

Tamaño: ~8.000 líneas. Ficheros más grandes: `AdminDashboard.jsx` (1.011), `server/index.js` (≈920), `i18n.jsx` (518), `server/db.js` (≈515).

### Colecciones del JSON

`sectors`, `tables`, `floor`, `categories`, `products`, `orders`, `reservations`, `settings`, `sessions` (tokens hasheados), `calls` (avisos de mesa). No existen: empleados, ventas, pagos, caja, documentos fiscales ni auditoría.

### API (35 rutas)

- Auth (PIN compartido): `POST /api/auth/login|logout`, `GET /api/auth/check|info`, `PUT /api/auth/pin`.
- Sala: `GET/PUT /api/tables[/:id]`, `GET /api/floor`, `POST /api/tables/layout`, `GET /api/availability`.
- Carta: `GET /api/menu`, `PUT /api/products/:id`, `POST /api/products/:id/image`. **No hay alta ni baja de productos ni categorías.**
- Pedidos: `POST /api/orders` (público), `GET /api/orders` (últimas 300), `GET /api/tables/:number/orders` (público), `PATCH /api/orders/:id/status`.
- Reservas: `GET/POST /api/reservations`, `GET/DELETE /api/reservations/:id`.
- Avisos: `POST /api/tables/:number/call`, `GET /api/calls`, `POST /api/calls/:id/ack`.
- Admin: copias (`/api/admin/backups`, `/backup/download`, `/restore`), ajustes (`/api/settings`), impresora (`/api/printer/history|test|reprint/:orderId`).

### Tiempo real (Socket.IO)

Salas `staff` (token en el handshake) y `table:<número>`. Eventos: `order:new`, `order:update`, `table:status_update`, `table:layout_update`, `floor:update`, `menu:update`, `settings:update`, `reservation:new`, `reservation:cancelled`, `call:new`, `call:resolved`.

## 2. Clasificación

Prioridad: **P0** bloquea fases siguientes o pone en riesgo datos · **P1** necesaria para operar como sistema integral · **P2** mejora.

### A · Conservar

| Funcionalidad | Archivos | Estado real | Nota |
| --- | --- | --- | --- |
| Web pública (portada, logo 3D, ES/EN, legal, cookies) | `views/Home.jsx`, `App.jsx`, `i18n.jsx`, `LegalPage.jsx`, `CookieNotice.jsx` | Funciona, probada en móvil | Solo mejoras puntuales (SEO, accesibilidad) |
| Plano interactivo y editor del salón | `components/FloorPlan.jsx`, `TableMap.jsx`, editor en `AdminDashboard.jsx`, `POST /api/tables/layout` | Funciona, autoguardado, validación en servidor | Base para el mapa del TPV |
| Reservas: disponibilidad y antisolape | `server/index.js` (reservas, `/api/availability`), `CustomerPortal.jsx`, `CancelReservation.jsx` | Probado con 20 reservas simultáneas: 1 aceptada | Se amplía (estados), no se rehace |
| Tiempo real | `server/index.js`, `context/SocketContext.jsx` | 40 móviles y 60 pedidos sin pérdidas | Se reutiliza para TPV y caja |
| Copias y recuperación | `server/db.js` (`backup`, `restore`, `loadLatestValidBackup`), `admin/BackupSection.jsx` | Probado (archivo dañado → recupera) | Se adapta al nuevo motor de datos |
| Carta pública y alérgenos | `components/MenuCatalog.jsx`, `CartDrawer.jsx` | Funciona | Productos actuales son de ejemplo |

### B · Corregir

| Problema | Archivos | Riesgo | Prioridad | Estado |
| --- | --- | --- | --- | --- |
| Se borraban comandas al superar 2.000 | `server/db.js` `createOrder` | Pérdida de historial | P0 | **Corregido 23/11** (prueba incluida) |
| Impresora: un fallo de conexión se registraba como «simulado» | `server/printer.js`, `admin/PrinterTest.jsx`, `KdsDisplay.jsx` | Comandas no impresas sin que nadie lo sepa | P0 | **Corregido 23/11**: estados `SENT` / `DISABLED` / `FAILED`, 3 intentos solo si no hubo conexión (sin duplicados) |
| QR inseguro: la mesa se identifica solo por su número en la URL (`/m/:n`) y en `POST /api/orders` | `App.jsx`, `TableOrderPortal.jsx`, `server/index.js` | Cualquiera puede pedir a otra mesa o ver sus comandas | P1 | **Corregido 23/11**: QR con clave por mesa; modo compatibilidad hasta reimprimir |
| Persistencia JSON: todo en memoria, se reescribe entero, sin transacciones ni relaciones | `server/db.js` | Inadecuada para caja, pagos y facturas (integridad, crecimiento) | P0 para fase 5 | **Corregido 23/11**: SQLite con migración verificada |
| Un solo estado de pedido mezcla preparación y cierre; liberar la mesa marca `SERVED → CLOSED` sin cobro | `server/index.js` (`ORDER_STATUSES`, `PUT /api/tables/:id`), `db.closeServedOrders` | «Cerrado» no significa «cobrado» | P1 | Se separa en fase 4 |
| Cambios de estado sin validar (cualquier estado → cualquiera), sin historial ni autor | `PATCH /api/orders/:id/status` | Sin trazabilidad | P1 | **En parte 23/11**: historial de estados con autor y auditoría; validación de transiciones en fase 4 |
| Historial de pedidos no consultable (solo últimas 300, sin filtros) | `GET /api/orders` | No hay «últimos 7 días» ni histórico | P1 | Fase 4 |
| PIN compartido: todos los usuarios tienen todos los permisos y nada identifica a quién hizo qué | `server/auth.js` | Sin control ni responsabilidad | P0 para fase 4–5 | **Corregido 23/11**: usuarios, roles y permisos en servidor |
| Historial de impresión solo en memoria (se pierde al reiniciar) | `server/printer.js` | Sin registro de impresiones | P2 | Fase 7 |
| `iconv-lite` se usa pero no está declarado (llega como dependencia de Express) | `server/printer.js`, `package.json` | Acentos en el ticket si cambia Express | P2 | Declararlo en la próxima instalación |
| No hay información de IVA en productos ni pedidos | `server/db.js`, carta | Imposible facturar correctamente | P0 para fase 6 | Fase 2 (modelo) |

### C · Ampliar

| Funcionalidad | Qué falta | Prioridad |
| --- | --- | --- |
| Carta (admin) | **Hecho 23/11**: altas, bajas, edición completa, IVA, área, opciones. Falta: extras con precio y reordenar arrastrando | P2 |
| KDS | Separar cocina y barra, prioridad, pedidos atrasados, estado por línea | P1 |
| Reservas | Estados (pendiente, confirmada, sentada, no presentada, cancelada), historial y autor | P2 |
| Pedidos | Líneas con estado propio, anulaciones con motivo y autor, origen (QR / TPV) | P1 |
| Panel admin | Secciones nuevas (TPV, caja, empleados, estadísticas…) con permisos | P1 |
| Impresión | Por área, cola persistente, agente local si el servidor va a la nube | P2 |

### D · Desarrollar

| Módulo | Depende de | Prioridad |
| --- | --- | --- |
| Empleados, roles y permisos (en servidor) | Modelo de datos | P0 |
| Auditoría append-only | Modelo de datos + empleados | P0 |
| TPV (sala, pedidos de camarero, traslados, división) | Empleados, pedidos ampliados | P1 |
| Pagos (efectivo, tarjeta registrada a mano, mixtos, parciales, devoluciones) | TPV, modelo transaccional | P1 |
| Caja (apertura, movimientos, cierre, arqueo) | Pagos, empleados | P1 |
| Facturación (simplificada/completa, rectificativas) | Pagos + decisión legal (ver `INTEGRACIONES.md`) | P1, bloqueada por decisión |
| Estadísticas | Ventas y pagos reales | P2 |
| Reseñas de Google (API oficial) | Acceso aprobado por Google | P2, bloqueada por credenciales |
| WhatsApp automático (Cloud API) | Cuenta de Meta y coste | P2, bloqueada por decisión |
| QR seguros por mesa (token revocable) | — | P1 |

## 3. Riesgos principales

1. **Cambiar el motor de datos con el local abierto.** Mitigación: migración en rama aparte, importación verificada y vuelta atrás posible (ver `ARQUITECTURA.md`).
2. **Facturación con valor legal.** Un programa de facturación propio obliga a cumplir el Reglamento de sistemas informáticos de facturación (RD 1007/2023). No se declarará cumplimiento sin verificarlo.
3. **Reimpresión de QR.** Los QR seguros cambian las URL de las mesas: hay que planificar el cambio.
4. **Servidor en el ordenador del local.** Si se apaga o cambia de red, nadie puede pedir. Publicar requiere un servidor con coste (pendiente de decisión del dueño).
