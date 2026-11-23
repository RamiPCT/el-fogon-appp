# 🔥 EL FOGÓN — Web + sistema de sala

Web pública del restaurante (portada, carta, reservas) y sistema de sala: plano de mesas en tiempo real, pedidos por QR desde la mesa, pantalla de cocina/barra (KDS), impresión térmica ESC/POS y panel del dueño.

---

## 📚 Documentación técnica
- `docs/ESTADO_Y_AUDITORIA.md` · qué hay, qué falla y qué falta
- `docs/ARQUITECTURA.md` · arquitectura, modelo de datos y decisiones
- `docs/INTEGRACIONES.md` · Veri*Factu, Google, WhatsApp, pagos, impresora
- `docs/PROGRESO.md` · fases, pruebas y siguiente tarea

## 🚀 Puesta en marcha

**Requisitos:** Node.js 22.12 o superior (los datos se guardan en SQLite, incluido en Node; no hay que instalar nada más). Comprueba tu versión con `node -v`.

```bash
cd "C:\Users\ramir\.gemini\antigravity\scratch\el-fogon-app"

# Desarrollo con recarga en caliente (servidor :3001 + web :5173)
npm run dev

# Producción local: compilar la web y servir todo desde :3001
npm run build
npm start
```

| Dónde | Enlace |
| :--- | :--- |
| Portátil (desarrollo) | http://localhost:5173 |
| Portátil (producción local) | http://localhost:3001 |
| Móvil en la misma Wi-Fi | `http://IP-DEL-PC:5173` (dev) o `http://IP-DEL-PC:3001` (prod). La IP sale con `ipconfig` → «Dirección IPv4». Si Windows pregunta, permite el acceso en redes privadas. |

> ⚠️ Después de cambiar código, vuelve a ejecutar `npm run build` antes de `npm start`; si no, verás la versión anterior.

### Usuarios del equipo
* Cada persona entra con **su usuario y contraseña** (Admin → 👥 Equipo). Roles: Administrador, Encargado, Camarero, Cocina y Barra; los permisos los comprueba el servidor.
* Todo queda en **Admin → 📜 Historial** (quién hizo qué y cuándo). Ese registro no se puede modificar ni borrar.
* Cuando todos tengan usuario, desactiva el PIN compartido en Ajustes → PIN del personal.

### QR de las mesas
* Admin → 🗺️ Plano → **QR de las mesas**: escribe la dirección con la que entran los móviles y pulsa «Imprimir QR de todas las mesas».
* Cada QR lleva una clave secreta de su mesa. Cuando estén colocados, desactiva «Aceptar también los QR antiguos».

### PIN del personal
* **En desarrollo, el PIN es `1234`.** La pantalla de acceso lo muestra mientras no lo cambies.
* Para cambiarlo: **Admin → Ajustes → PIN del personal** (se guarda cifrado).
* En el servidor también puedes fijarlo con la variable `STAFF_PIN` (si existe, manda sobre el de Ajustes).
* En producción el servidor no arranca si no hay PIN configurado.

> Si el PIN «no entra» o algo no se actualiza, seguramente hay **otra copia vieja del servidor abierta**: cierra todas las terminales y vuelve a lanzar `npm run dev`. El servidor ahora avisa en consola si el puerto 3001 está ocupado.

---

## 📱 Rutas

| Ruta | Para qué |
| :--- | :--- |
| `/` | **Portada pública**: caballo animado, la casa, destacados de la carta, horario, ubicación, WhatsApp. |
| `/reservar` | **Reservar**: eliges día, hora y personas y el plano muestra solo las mesas libres para ese momento; se confirma por WhatsApp. |
| `/bienvenido` (alias `/plano`) | **QR de la entrada**: estado de las mesas en directo para sentarse y pedir. Avisa si la mesa tiene una reserva más tarde. |
| `/carta` | Carta completa (solo consulta). |
| `/m/04` (`/m/:numero`) | **QR de mesa**: carta, pedido compartido en tiempo real, seguimiento por pasos, «Llamar al camarero» y «Pedir la cuenta». |
| `/q/<clave>` | QR de una mesa: abre la carta de esa mesa para pedir. |
| `/kds` | Pantalla de cocina/barra (requiere acceso de personal): comandas en vivo y avisos de las mesas. Toca «Activar sonido» al abrirla en la tablet. |
| `/admin` | Panel (pestañas según el rol): plano y QR, reservas, carta (altas, bajas, precios, fotos, alérgenos, IVA), equipo, historial y ajustes. |
| `/cancelar/:id` | Enlace secreto que recibe el cliente para cancelar su reserva. |
| `/aviso-legal`, `/privacidad`, `/cookies` | Textos legales (se rellenan con los datos de Admin → Ajustes). |

La parte pública está en **español (España) e inglés**; el idioma se detecta solo y se puede cambiar arriba a la derecha.

---

## ✅ Antes de entregarlo al cliente (checklist)

1. **Admin → Ajustes**: WhatsApp de reservas, dirección, horario, Instagram, enlace de reseñas de Google, razón social y NIF.
2. **Admin → Carta**: precios reales y **alérgenos de cada plato confirmados por la cocina** (obligatorio en España).
3. Sustituir las fotos de ejemplo (Unsplash) por fotos reales del local y de los platos.
4. Revisar los textos legales con un asesor.
5. Definir `STAFF_PIN` (mínimo 6 dígitos) y `PUBLIC_URL` en el servidor.
6. Imprimir los QR de cada mesa apuntando a `https://TU-DOMINIO/m/NUMERO`.

---

## 💾 Copias de seguridad
- Se crea una copia automática al arrancar el servidor y otra cada día en `server/data/backups/` (se guardan las últimas 40).
- Si `db.json` se daña, el servidor arranca solo desde la última copia válida.
- Admin → Ajustes → **Copias de seguridad**: descargar la copia actual, crear una ahora o restaurar (antes de restaurar se guarda otra copia por si acaso).
- Las fotos subidas de los platos se guardan en `server/data/uploads/`. En Railway/Render, `DATA_DIR` debe apuntar a un volumen para no perderlas.

## 🧪 Pruebas automáticas
```bash
npm test
```
Arranca el servidor con datos temporales (no toca los reales) y comprueba acceso y permisos por rol, pedidos y precios, QR seguros, reservas solapadas, plano, carta, fotos, copias, migración a SQLite, recuperación e historial de actividad.

## ☁️ Publicar (Railway o Render)

Esta app **no funciona en Vercel/Netlify**: necesita un servidor encendido (WebSockets en tiempo real) y un disco donde guardar `db.json`.

**Railway** (recomendado):
1. Sube el proyecto a GitHub y crea un servicio nuevo desde el repositorio.
2. *Build command*: `npm install && npm run build:deploy` · *Start command*: `npm start`.
3. Añade un **Volume** montado en `/data`.
4. Variables: `NODE_ENV=production`, `STAFF_PIN=…`, `DATA_DIR=/data`, `PUBLIC_URL=https://tu-dominio`.
5. Conecta tu dominio en *Settings → Networking*.

En **Render** es igual: *Web Service* + *Persistent Disk* montado en `/data`.

> La primera vez que arranque con `DATA_DIR` vacío se creará una base de datos de ejemplo. Para llevar tus datos actuales, copia `server/data/db.json` al volumen.

---

## 🔒 Seguridad

* El PIN se comprueba **en el servidor**; el navegador recibe un token temporal (24 h). Máx. 5 intentos fallidos cada 15 min por IP.
* Todas las rutas de gestión (ajustes, mesas, carta, comandas, reservas, impresora) exigen sesión de personal.
* Los precios de los pedidos se calculan en el servidor con la carta: el navegador no puede cambiarlos.
* Los nombres y teléfonos de las reservas solo los ve el personal. Los datos de contacto se **anonimizan solos a los 6 meses** (RGPD).
* Los enlaces de cancelación usan identificadores imposibles de adivinar.

---

## 🎨 Identidad visual (manual de marca)

* **Tipografías:** `Cinzel` (títulos), `Great Vibes` (acentos cortos), `Montserrat` (lectura).
* **Paleta:** carbón `#121212` · verde botella `#14281D` · bordó `#5A1826` · dorado `#C8A45D` · crema `#F4EFE6`.

---

## 🖨️ Impresora térmica (ESC/POS)

`server/printer.js` envía el ticket por red (TCP, por defecto `192.168.1.100:9100`) usando la tabla de caracteres PC858 para que salgan bien acentos, ñ y €. Si la impresora está desactivada o no responde, el ticket se simula en la consola del servidor.

## 💬 WhatsApp sin coste de API

Se usa `https://wa.me/{NUMERO}?text={MENSAJE}`: el cliente toca un botón y se abre su WhatsApp con el mensaje listo para enviar.
