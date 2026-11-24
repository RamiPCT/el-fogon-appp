# El Fogón · Progreso, pruebas y próximas tareas

Documento vivo: se actualiza al final de cada sesión. Contexto: `ESTADO_Y_AUDITORIA.md`, `ARQUITECTURA.md`, `INTEGRACIONES.md`.

## Fases

| Fase | Estado |
| --- | --- |
| 1 · Auditoría y diagnóstico | Hecha (23/11/2026) |
| 2 · Arquitectura y datos | Hecha: SQLite con migración verificada (23/11) |
| 3 · Usuarios y permisos | Hecha: empleados, roles, permisos en servidor, historial de actividad (23/11) |
| 4 · TPV y operaciones | Hecha: comandera, cuenta por mesa, anular e invitar con motivo, descuentos (24/11) |
| 5 · Pagos y caja | Hecha: cobros efectivo/tarjeta/otro, parciales, mixtos, dividir, cambio, devoluciones; caja con apertura, movimientos, cierre y arqueo (24/11) |
| 6 · Facturación | Hecha la estructura: ticket de cuenta, simplificada, completa, rectificativa, encadenadas e inalterables. Falta: datos fiscales reales y verificar requisitos Veri*Factu antes de su fecha |
| 7 · Integraciones | Google: al publicar. WhatsApp: sin API (D10) |
| 8 · Estadísticas y experiencia | Pendiente |
| 9 · Pruebas y despliegue | Continua |

## Decisiones del dueño (23/11)

1. D2 · SQLite: sí, dejando abierta una migración futura a una base de pago.
2. D6 · Facturación: avanzar todo lo posible sin cargar todavía los datos fiscales.
3. D5 · Tarjeta: datáfono del banco y registro manual en el TPV.
4. D7 · QR: se reimprimen en unos días (los antiguos siguen funcionando hasta entonces).
5. WhatsApp: sin coste; la reserva se guarda sola y el cliente confirma enviando el mensaje.
6. Google: cuando la web sea pública.

## Sesiones

### 24/11/2026 · TPV completo: cuentas, cobros, caja y facturas

1. **Completado:** cada pedido (QR o comandera) se suma a la cuenta abierta de su mesa; anular e invitar platos con motivo y autor (encargado/admin); descuento % o € con motivo; cobro en efectivo (con cambio), tarjeta (datáfono, registro manual) u otro; cobros parciales, mixtos y división entre N o por platos; protección contra cobros duplicados (`Idempotency-Key`); al saldar, la mesa se libera y las comandas pasan a CLOSED; no se puede liberar una mesa con cuenta pendiente; devoluciones (reabren la cuenta); caja: apertura con fondo, entradas/salidas con motivo, cierre con efectivo contado y descuadre, resumen imprimible e historial; ticket de cuenta (no fiscal); factura simplificada, completa (sustituye a la simplificada) y rectificativa, numeración por serie y año, IVA desglosado, cadena de huellas SHA-256 y comprobación de integridad; KDS tacha lo anulado; copias de seguridad completas (.sqlite) y recuperación desde ellas.
2. **Archivos nuevos:** `server/sales.js`, `server/receipts.js`, `client/src/components/admin/{CheckPanel,CajaTab}.jsx`, `client/src/utils/money.js`. **Cambiados:** `server/{store,db,index,staff,printer}.js`, `ComanderaTab.jsx`, `AdminDashboard.jsx`, `SettingsTab.jsx`, `KdsDisplay.jsx`, `tests/api.test.js`.
3. **Pruebas:** `npm test` 28/28 (nuevas: cuenta y cobro mixto, idempotencia, mesa con cuenta pendiente, facturas y cadena, devolución y arqueo, triggers de inalterabilidad). Navegador: servicio completo con encargada y camarero en móvil 20/20; resto de pruebas sin cambios.
4. **Pendiente:** cargar los datos fiscales reales (Ajustes → Datos fiscales); revisar con el asesor el IVA de cada producto; antes de la fecha obligatoria de Veri*Factu, verificar el formato de registro, el QR tributario y el envío a la AEAT.
5. **Siguiente tarea exacta:** estadísticas de ventas (por día/semana/mes, productos, horas, empleados, formas de pago) a partir de `payments`, `checks` y `order_items`.

### 23/11/2026 (tarde) · Fases 2 y 3, carta y QR seguros · rama `fase-2`

1. **Completado:**
   - SQLite (`node:sqlite`): migración automática desde `db.json` con verificación y sin tocar el original; recuperación si el archivo se daña; transacciones.
   - Empleados con usuario y contraseña, 5 roles, permisos comprobados en cada ruta, PIN del local como acceso «Dueño (PIN)» desactivable, sesiones que se cierran al desactivar o cambiar contraseña.
   - Historial de actividad de solo escritura (inicios de sesión, ajustes, carta, comandas, reservas, equipo, copias…) y pestaña Historial.
   - Historial de estados en cada comanda con el empleado que lo cambió; origen del pedido (`qr` / `pos`).
   - Carta: crear y dar de baja categorías y platos (sin borrar), editar todo, IVA, cocina/barra, opciones del plato.
   - QR seguros: clave secreta por mesa (`/q/<clave>`), hoja de impresión A4, regenerar, modo compatibilidad.
   - Pantalla de acceso con usuario o PIN; pestañas del panel según permisos.
2. **Archivos nuevos:** `server/store.js`, `server/staff.js`, `client/src/hooks/useStaff.js`, `client/src/utils/tableKey.js`, `client/src/components/admin/{TeamTab,AuditTab,QrSection}.jsx`. **Cambiados:** `server/{db,auth,index,time}.js`, `client/src/{App.jsx,utils/api.js,components/StaffLogin.jsx,components/admin/{MenuTab,SettingsTab}.jsx,views/{AdminDashboard,TableOrderPortal}.jsx}`, `package.json` (scripts con `--experimental-sqlite`, Node ≥ 22.12), `tests/api.test.js`.
3. **Pruebas:** `npm test` 23/23 (nuevas: migración desde db.json, base dañada, historial > 2.000, empleados y permisos por rol, sesión cerrada al desactivar, PIN desactivable, auditoría inalterable, carta, QR seguros). Navegador: 42/43 (fallo esperado), panel 17/17, equipo y roles 19/19, QR 10/10. Carga: 40 móviles, 60 pedidos simultáneos guardados en SQLite sin duplicados. Migración probada con una copia de los datos reales del local. QR real generado con la librería instalada en el ordenador del local.
4. **Pendiente:** confirmar `node -v` en el ordenador del local (≥ 22.12) antes de instalar esta versión; reimprimir los QR y desactivar los antiguos; crear los usuarios del equipo.
5. **Siguiente tarea exacta:** Fase 4 · TPV: cuenta por mesa (`checks`), pedido desde el TPV por el camarero, separar comandas de cocina y barra en el KDS (por `area`), validar transiciones de estado y anular líneas con motivo.

### 23/11/2026 (mañana) · Auditoría y correcciones urgentes

- Auditoría completa y documentación en `docs/`. Corregido: ya no se borran comandas antiguas; la impresora distingue enviado / desactivado / fallido. `npm test` 15/15.

## Instalar esta versión en el ordenador del local

1. `node -v` debe mostrar 22.12 o superior. Si no, instalar la versión LTS de https://nodejs.org.
2. Parar el servidor (Ctrl+C), copiar los archivos nuevos, `npm run build` y `npm start`.
3. Al arrancar verás «✅ Datos migrados de db.json a fogon.sqlite». `db.json` queda intacto como copia.
4. Volver atrás: Admin → Ajustes → Descargar copia actual, instalar la versión anterior y restaurar esa copia.

## Cómo probar

```bash
npm test          # pruebas del servidor con datos temporales (no tocan los reales)
npm run build     # compila la web
npm start         # arranca en http://localhost:3001
```
