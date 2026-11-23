# El Fogón · Arquitectura y modelo de datos

Documento de referencia. Las decisiones marcadas **PENDIENTE** necesitan aprobación del dueño antes de implementarse.

## 1. Principios

- **Un solo sistema.** Monolito modular Node/Express + React (el actual). Sin microservicios ni reescritura.
- **Una sola fuente de verdad.** Un pedido es un pedido venga del QR o del TPV (campo `origin`). Una mesa, un producto o un empleado existen en un único sitio.
- **Validar y autorizar en el servidor.** El navegador nunca decide precios, permisos ni totales.
- **Nada se borra en silencio.** Las anulaciones y correcciones son registros nuevos. La auditoría solo admite altas.
- **Dinero en céntimos enteros** (`2350` = 23,50 €) para evitar errores de redondeo. La API sigue aceptando y devolviendo euros donde hoy lo hace, para no romper el cliente.
- **Hora de Madrid** para todo lo que ve el personal (`server/time.js`); en datos se guarda UTC en ISO 8601.

## 2. Módulos y dependencias

```
                 ┌──────────── Web pública · Carta · Reservas · QR ───────────┐
                 │                                                            │
Empleados/roles ─┼─> TPV ──> Pedidos (único) ──> Cocina/Barra (KDS, impresora) │
      │          │              │                                             │
      │          │              └─> Venta (cuenta) ──> Pagos ──> Caja         │
      │          │                                       │                    │
      │          │                                       └─> Documento fiscal │
      └──────────┴──> Auditoría (todo lo anterior escribe aquí) ──> Estadísticas
```

Orden obligatorio: **datos → empleados/permisos → auditoría → pedidos/TPV → pagos/caja → facturación → integraciones → estadísticas.** Cada fase usa lo anterior.

Organización del servidor a medida que crezca (sin cambiar rutas existentes):

```
server/
  index.js            arranque, middlewares, sockets (se irá aligerando)
  db/                 conexión, migraciones, importación desde db.json
  modules/<dominio>/  rutas + lógica: auth, staff, menu, tables, orders, reservations,
                      payments, cash, invoices, audit, stats, integrations
```

## 3. Persistencia · PENDIENTE (decisión D2)

### Por qué el JSON actual no sirve para lo que viene

- Todo vive en memoria y se reescribe el archivo entero en cada cambio: con meses de pedidos, pagos y auditoría, cada operación será más lenta y un corte de luz a mitad de escritura depende solo del rename atómico.
- No hay transacciones: un cobro que toca pago + venta + caja + auditoría puede quedar a medias.
- No hay relaciones ni restricciones (claves únicas, foráneas): la integridad depende de que el código no se equivoque nunca.
- La numeración de facturas exige secuencias sin huecos ni duplicados, imposible de garantizar bien en un JSON.

### Alternativas

| Opción | A favor | En contra |
| --- | --- | --- |
| **SQLite con `node:sqlite` (recomendada)** | Viene incluido en Node (cero dependencias, cero coste), un solo archivo fácil de copiar, transacciones ACID, modo WAL, sobrado para un restaurante | En Node 22 se marca «experimental» (avisa en consola); necesita Node ≥ 22.13 en el ordenador del local |
| SQLite con `better-sqlite3` | Estable y muy usado | Dependencia nativa: compilación en Windows puede fallar |
| PostgreSQL | El más completo | Servidor aparte, más mantenimiento; en la nube suele tener coste |
| Seguir con JSON | Nada que migrar | Bloquea caja y facturación con garantías |

Comprobado el 23/11/2026: `node:sqlite` funciona con Node 22.23 sin instalar nada.

### Plan de migración (sin pérdida de datos)

1. Se desarrolla en una rama aparte; el local sigue con la versión actual.
2. Al arrancar la nueva versión: si no existe `fogon.sqlite`, se crea el esquema y se **importa `db.json` en una sola transacción**. `db.json` no se modifica ni se borra; se guarda además una copia `db-antes-de-migrar.json`.
3. Verificación automática tras importar: mismo número de mesas, productos, categorías, pedidos y reservas, y mismos totales de pedidos. Si algo no cuadra, se deshace la transacción y la app sigue con el JSON.
4. Las copias de seguridad pasan a ser copias del archivo SQLite (`VACUUM INTO`) con la misma pantalla de Admin.
5. Vuelta atrás: instalar la versión anterior, que sigue leyendo `db.json` tal y como quedó.

## 4. Modelo de datos objetivo

Claves `TEXT` con prefijo legible (`ord-…`, `emp-…`), como hoy, para mantener los identificadores existentes. Fechas en ISO UTC. Importes en céntimos.

| Entidad | Campos clave | Relaciones / reglas |
| --- | --- | --- |
| `employees` | id, name, username (único), password_hash (scrypt), role_id, active, pin_hash (opcional, acceso rápido en TPV), created_at | Nunca se borran: se desactivan |
| `roles`, `role_permissions` | role: admin, manager, waiter, kitchen, bar; permisos como texto (`orders.void`, `cash.close`…) | Comprobados en cada ruta del servidor |
| `sessions` | token_hash, employee_id, device, created_at, last_seen | Ya existe (hoy sin empleado) |
| `sectors`, `tables`, `floor` | Igual que hoy + `qr_token` (revocable) | `tables.number` único |
| `categories` | id, name, name_en, sort, area (`kitchen`/`bar`), active | |
| `products` | id, category_id, name(_en), description(_en), price_cents, vat_rate, area (hereda de categoría), image, allergens, available, active, sort | Borrado = `active=0` (los pedidos antiguos lo referencian) |
| `modifier_groups`, `modifier_options` | grupo (obligatorio, máx. elecciones), opción con `price_delta_cents` | Hoy los modificadores viven dentro del producto: se importan a estas tablas |
| `orders` | id, order_number, table_id, origin (`qr`/`pos`), employee_id, status, notes, created_at, idempotency_key (único) | Un pedido = una tanda enviada a cocina |
| `order_items` | id, order_id, product_id, name, unit_price_cents, vat_rate, qty, modifiers, notes, area, prep_status, voided_at, voided_by, void_reason | Se copian nombre, precio e IVA del momento: cambiar la carta no altera el pasado |
| `order_status_history` | order_id / item_id, from, to, employee_id, at | Trazabilidad de estados |
| `checks` (cuenta / venta) | id, table_id, opened_at, opened_by, closed_at, status (`open`/`paid`/`voided`), total_cents, discount_cents | Agrupa los pedidos de una mesa; permite dividir y trasladar |
| `payments` | id, check_id, method (`cash`/`card`/`other`), amount_cents, tip_cents, employee_id, cash_session_id, created_at, refund_of, idempotency_key | Pagos parciales y mixtos = varias filas; devolución = fila negativa enlazada |
| `cash_sessions` | id, opened_by, opened_at, opening_cents, closed_by, closed_at, expected_cents, counted_cents, difference_cents | Una abierta a la vez por caja |
| `cash_movements` | id, cash_session_id, type (`in`/`out`), amount_cents, reason, employee_id, at | |
| `invoices` | id, series, number, type (`simplified`/`full`/`rectifying`), check_id, customer (si completa), lines, bases y cuotas por tipo de IVA, total, issued_at, issued_by, hash, prev_hash | Numeración correlativa por serie; nunca se editan ni se borran |
| `reservations` | Igual que hoy + estados `pending/confirmed/seated/no_show/cancelled` y `employee_id` cuando la crea el personal | |
| `audit_log` | id (autoincremental), at, employee_id, action, entity, entity_id, before, after, result, ip | Solo INSERT: triggers que impiden UPDATE y DELETE |
| `settings` | clave/valor | Ya existe |
| `printers`, `print_jobs` | impresora por área; trabajo con estado `SENT/FAILED/DISABLED`, intentos, error | Hoy el historial solo está en memoria |
| `integrations` | tipo, estado, última sincronización, error (sin secretos: van en `.env`) | Google, WhatsApp |

### Estados (separados, como pide el plan)

| Eje | Valores | Dónde |
| --- | --- | --- |
| Preparación | `RECEIVED → IN_PREP → READY → SERVED` (o `VOIDED`) | `orders.status` y `order_items.prep_status` (compatibles con los actuales) |
| Cobro | `open → paid` (con saldo pendiente mientras haya pagos parciales) / `voided` | `checks.status` + suma de `payments` |
| Facturación | sin documento / simplificada / completa / rectificada | `invoices` enlazadas a `checks` |

El actual `CLOSED` de los pedidos se mantiene como «servido y mesa liberada» para los datos antiguos; los nuevos cierres se expresan con la cuenta (`checks`).

### Operaciones críticas

- Toda operación de dinero en **una transacción** (pago + cuenta + caja + auditoría).
- **Idempotencia**: el cliente envía `Idempotency-Key` en pedidos y pagos; si se repite, el servidor devuelve el resultado original en vez de duplicar.
- **Anulaciones** con permiso, motivo obligatorio y registro en auditoría; nunca se borra la línea.

## 5. Seguridad

- Contraseñas con `scrypt` (ya usado para el PIN, `server/auth.js`), sesiones con token aleatorio guardado como hash (ya implementado), bloqueo por intentos (ya implementado: 10 en 10 min).
- Permisos comprobados en el servidor con un middleware `requirePermission('...')`.
- QR de mesa con token aleatorio y revocable; el número de mesa en la URL deja de servir como autorización.
- Secretos de integraciones solo en variables de entorno, nunca en la base de datos ni en el repositorio.

## 6. Registro de decisiones

| # | Decisión | Estado |
| --- | --- | --- |
| D1 | Mantener React + Node/Express + Socket.IO y ampliar sobre lo existente | Aprobada (plan maestro) |
| D2 | Migrar de JSON a SQLite (`node:sqlite`) con importación verificada | **PENDIENTE** |
| D3 | Importes en céntimos enteros; IVA por producto copiado a cada línea | Propuesta |
| D4 | Un único modelo de pedidos para QR y TPV | Propuesta |
| D5 | Tarjeta: datáfono del banco, el cobro se registra a mano en el TPV (sin pasarela integrada) | **PENDIENTE** |
| D6 | Facturación: alcance legal (ver `INTEGRACIONES.md`) | **PENDIENTE** |
| D7 | QR seguros: requiere reimprimir los QR de las mesas | **PENDIENTE** (cuándo) |
| D8 | Impresión: cuando el servidor esté en la nube, un agente local en el ordenador del local reenvía a la impresora | Propuesta (solo si se publica en la nube) |
