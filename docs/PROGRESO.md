# El Fogón · Progreso, pruebas y próximas tareas

Documento vivo: se actualiza al final de cada sesión. Contexto: `ESTADO_Y_AUDITORIA.md`, `ARQUITECTURA.md`, `INTEGRACIONES.md`.

## Fases

| Fase | Estado |
| --- | --- |
| 1 · Auditoría y diagnóstico | Hecha (23/11/2026) |
| 2 · Arquitectura y datos | Diseño hecho; implementación **bloqueada por D2** (motor de datos) |
| 3 · Usuarios y permisos | Sin empezar (depende de la fase 2) |
| 4 · TPV y operaciones | Sin empezar |
| 5 · Pagos y caja | Sin empezar |
| 6 · Facturación | Bloqueada por D6 (alcance legal) |
| 7 · Integraciones | Bloqueada por credenciales y costes |
| 8 · Estadísticas y experiencia | Sin empezar |
| 9 · Pruebas y despliegue | Continua: cada fase añade pruebas |

## Decisiones que necesita el dueño

1. **D2** · ¿Migramos los datos de JSON a SQLite (incluido en Node, sin coste)? Antes: ejecutar `node -v` en el ordenador del local (hace falta 22.13 o superior).
2. **D6** · ¿Sociedad o autónomo? ¿Hay ya un TPV fiscal? ¿El Fogón debe emitir tickets y facturas con valor fiscal?
3. **D5** · ¿Tarjeta con el datáfono del banco registrada a mano en el TPV?
4. **D7** · ¿Cuándo se pueden reimprimir los QR de las mesas para hacerlos seguros?
5. Integraciones: ¿WhatsApp automático con coste por mensaje? ¿Acceso a la ficha de Google?

## Sesiones

### 23/11/2026 · Auditoría y correcciones urgentes

1. **Completado:** auditoría completa; arquitectura, modelo de datos y plan; normativa e integraciones verificadas; dos correcciones P0.
2. **Archivos:** `server/db.js` (ya no se borran comandas antiguas), `server/printer.js` (estados `SENT`/`DISABLED`/`FAILED`, reintentos sin duplicados, historial limitado a 200), `server/index.js` (reintentos en pedidos, error en la prueba de impresora), `client/src/components/admin/PrinterTest.jsx`, `client/src/views/KdsDisplay.jsx`, `tests/api.test.js`, `docs/*`.
3. **Pruebas:** `npm test` 15/15 (2 nuevas: impresora real/fallida/desactivada con impresora TCP falsa; historial de más de 2.000 comandas). Navegador: 42/43 (el fallo es esperado: cambiar el PIN cierra la sesión del KDS) y 17/17 de las funciones del panel.
4. **Pendiente:** decisiones D2, D5, D6, D7 e integraciones.
5. **Siguiente tarea exacta:** con D2 aprobada, crear `server/db/` con el esquema SQLite, el importador desde `db.json` con verificación y pruebas de migración sobre una copia de los datos reales; sin tocar la versión que usa el local.

## Cómo probar

```bash
npm test          # pruebas del servidor con datos temporales (no tocan los reales)
npm run build     # compila la web
npm start         # arranca en http://localhost:3001
```
