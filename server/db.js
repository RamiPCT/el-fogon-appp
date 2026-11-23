const fs = require('fs');
const path = require('path');

// En producción (Railway/Render) apunta DATA_DIR a un volumen persistente.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_BACKUPS = 40; // ~ 2 semanas con copia al arrancar + diaria

// Los 14 alérgenos de declaración obligatoria en la UE (Reglamento 1169/2011)
const ALLERGENS = [
  'gluten', 'crustaceos', 'huevo', 'pescado', 'cacahuetes', 'soja', 'lacteos',
  'frutos_cascara', 'apio', 'mostaza', 'sesamo', 'sulfitos', 'altramuces', 'moluscos'
];

const DEFAULT_SETTINGS = {
  restaurantName: 'El Fogón',
  subtitle: 'Picoteo & Coctelería de Autor',
  ownerPhone: '',            // WhatsApp que recibe las reservas (con prefijo, ej: 34600000000)
  publicPhone: '',           // Teléfono para llamar (opcional)
  email: '',
  instagram: '',             // usuario sin @
  address: '',
  postalCode: '',
  city: 'Alicante',
  mapsUrl: '',               // enlace a Google Maps
  openingHours: '',          // una línea por día/franja
  openingHours_en: '',
  legalName: '',             // razón social del titular (Aviso legal)
  nif: '',
  currency: '€',
  timezone: 'Europe/Madrid',
  barPosition: 'top',
  bufferMinutes: 15,
  soonWindowMinutes: 120,         // cuánto antes se marca una mesa como "reserva próxima"
  reservationDurationMinutes: 120, // duración estimada de una reserva (evita solapes)
  bookingStart: '12:00',          // primera hora reservable
  bookingEnd: '23:30',            // última hora reservable
  googleReviewUrl: '',
  printerEnabled: false,
  printerIp: '192.168.1.100',
  printerPort: 9100
};

// Textos en inglés para la carta de ejemplo (se aplican solo si faltan)
const PRODUCT_EN = {
  'prod-chicharron': { name_en: 'El Fogón Crispy Pork Belly', description_en: 'Slow-cooked crispy pork belly with golden criollo potatoes and lime.' },
  'prod-empanadas': { name_en: 'Fire Empanadas (x3)', description_en: 'Handmade pastry filled with hand-cut beef tenderloin, spring onion and a smoky touch.' },
  'prod-papas-criollas': { name_en: 'Cauldron Criollo Potatoes', description_en: 'Whole fried criollo potatoes with sea salt, charred rosemary and black garlic mayo.' },
  'prod-tabla-fogon': { name_en: 'Big El Fogón Board (2-3 people)', description_en: 'Pork belly, empanadas, crispy lemon sweetbreads, criollo potatoes and 3 sauces.' },
  'prod-old-fashioned': { name_en: 'Oak-Smoked Old Fashioned', description_en: 'Bourbon macerated with oak bark, orange peel, aromatic bitters and smoke under a cloche.' },
  'prod-gin-fogon': { name_en: 'El Fogón Botanical Gin & Tonic', description_en: 'Premium gin infused with toasted juniper, torched grapefruit and premium tonic.' },
  'prod-ipa': { name_en: 'Draught IPA (Pint)', description_en: 'Hoppy craft beer served ice-cold from the bar.' },
  'prod-volcan': { name_en: 'Fire Volcano & Dulce de Leche', description_en: 'Warm sponge cake filled with molten dulce de leche, served with cream ice cream.' }
};

const CATEGORY_EN = {
  'cat-picoteo': { name_en: '🍢 To Share', description_en: 'Gourmet bites made for sharing' },
  'cat-fuego': { name_en: '🔥 From the Grill', description_en: 'Charcoal-grilled specialities' },
  'cat-cocteles': { name_en: '🍸 Signature Cocktails', description_en: 'Smoked cocktails and botanical infusions' },
  'cat-bebidas': { name_en: '🍺 Beers & Wines', description_en: 'Draught craft beer and selected wines' },
  'cat-postres': { name_en: '🍰 Sweet Finish', description_en: 'Homemade desserts' }
};

// Plano del local: cuadrícula de celdas de 20 unidades. Las mesas usan las mismas unidades (x, y, width, height).
const FLOOR_CELL = 20;
const FLOOR_ELEMENT_TYPES = ['bar', 'wall', 'zone', 'entrance', 'kitchen', 'wc', 'plant'];

function defaultFloor(tables = []) {
  const maxX = tables.reduce((m, t) => Math.max(m, (t.x || 0) + (t.width || 75)), 360);
  const maxY = tables.reduce((m, t) => Math.max(m, (t.y || 0) + (t.height || 65)), 320);
  const cols = Math.min(80, Math.max(16, Math.ceil((maxX + FLOOR_CELL) / FLOOR_CELL)));
  const rows = Math.min(80, Math.max(16, Math.ceil((maxY + FLOOR_CELL * 3) / FLOOR_CELL)));
  const W = cols * FLOOR_CELL;
  const H = rows * FLOOR_CELL;
  return {
    cols,
    rows,
    cell: FLOOR_CELL,
    voids: [],
    elements: [
      { id: 'el-bar', type: 'bar', x: 60, y: 0, w: Math.min(W - 80, 300), h: 30, label: 'Barra de coctelería' },
      { id: 'el-entrance', type: 'entrance', x: Math.round((W / 2 - 50) / FLOOR_CELL) * FLOOR_CELL, y: H - FLOOR_CELL, w: 100, h: FLOOR_CELL, label: 'Entrada' }
    ]
  };
}

const INITIAL_DATA = {
  sectors: [
    { id: 'sec-salon', name: 'Salón Principal', floor: 1 },
    { id: 'sec-barra', name: 'Barra de Coctelería', floor: 1 },
    { id: 'sec-terraza', name: 'Galería y Terraza', floor: 1 }
  ],
  tables: [
    { id: 'tbl-01', number: '01', sectorId: 'sec-salon', capacity: 4, x: 60, y: 150, width: 80, height: 70, shape: 'rect', status: 'AVAILABLE' },
    { id: 'tbl-02', number: '02', sectorId: 'sec-salon', capacity: 2, x: 180, y: 150, width: 70, height: 70, shape: 'round', status: 'AVAILABLE' },
    { id: 'tbl-03', number: '03', sectorId: 'sec-salon', capacity: 4, x: 290, y: 150, width: 80, height: 70, shape: 'rect', status: 'AVAILABLE' },
    { id: 'tbl-04', number: '04', sectorId: 'sec-salon', capacity: 4, x: 60, y: 250, width: 80, height: 70, shape: 'rect', status: 'AVAILABLE' },
    { id: 'tbl-05', number: '05', sectorId: 'sec-salon', capacity: 6, x: 180, y: 250, width: 90, height: 70, shape: 'rect', status: 'AVAILABLE' },
    { id: 'tbl-06', number: '06', sectorId: 'sec-salon', capacity: 4, x: 290, y: 250, width: 80, height: 70, shape: 'rect', status: 'AVAILABLE' },
    { id: 'tbl-b1', number: 'B1', sectorId: 'sec-barra', capacity: 1, x: 90, y: 50, width: 45, height: 45, shape: 'bar_stool', status: 'AVAILABLE' },
    { id: 'tbl-b2', number: 'B2', sectorId: 'sec-barra', capacity: 1, x: 160, y: 50, width: 45, height: 45, shape: 'bar_stool', status: 'AVAILABLE' },
    { id: 'tbl-b3', number: 'B3', sectorId: 'sec-barra', capacity: 1, x: 230, y: 50, width: 45, height: 45, shape: 'bar_stool', status: 'AVAILABLE' },
    { id: 'tbl-b4', number: 'B4', sectorId: 'sec-barra', capacity: 1, x: 300, y: 50, width: 45, height: 45, shape: 'bar_stool', status: 'AVAILABLE' }
  ],
  reservations: [],
  categories: [
    { id: 'cat-picoteo', name: '🍢 Para Picar', description: 'Porciones gourmet ideales para compartir' },
    { id: 'cat-fuego', name: '🔥 Al Carbón', description: 'Especialidades a las brasas' },
    { id: 'cat-cocteles', name: '🍸 Coctelería de Autor', description: 'Cócteles ahumados e infusiones botánicas' },
    { id: 'cat-bebidas', name: '🍺 Cervezas y Vinos', description: 'Cerveza artesanal de grifo y vinos seleccionados' },
    { id: 'cat-postres', name: '🍰 Dulce Final', description: 'Postres artesanales' }
  ],
  products: [
    {
      id: 'prod-chicharron', categoryId: 'cat-picoteo', name: 'Chicharrón Crocante El Fogón',
      description: 'Panceta crujiente cocinada a fuego lento, con papas criollas doradas y lima.',
      price: 8.5, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, badge: 'Favorito', allergens: [],
      modifiers: [
        { id: 'sauce', name: 'Salsa', required: true, options: ['Ají Criollo Casero', 'Guacamole Rústico', 'Suero Costeño', 'BBQ Ahumada'] },
        { id: 'crispiness', name: 'Punto de crocancia', required: false, options: ['Bien crocante', 'Término medio'] }
      ]
    },
    {
      id: 'prod-empanadas', categoryId: 'cat-picoteo', name: 'Empanaditas de Fuego (x3)',
      description: 'Masa artesanal rellena de solomillo cortado a cuchillo con cebolleta y toque ahumado.',
      price: 6.5, image: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, badge: 'Casero', allergens: [],
      modifiers: [{ id: 'spice', name: 'Picante', required: false, options: ['Con ají picante', 'Sin picante'] }]
    },
    {
      id: 'prod-papas-criollas', categoryId: 'cat-picoteo', name: 'Papas Criollas al Caldero',
      description: 'Papas criollas enteras fritas con sal marina, romero quemado y mayonesa de ajo negro.',
      price: 5, image: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, allergens: [], modifiers: []
    },
    {
      id: 'prod-tabla-fogon', categoryId: 'cat-picoteo', name: 'Gran Tabla El Fogón (2-3 pers)',
      description: 'Selección de chicharrones, empanaditas, mollejas crujientes al limón, papas criollas y 3 salsas.',
      price: 18.5, image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, badge: 'Para Compartir', allergens: [], modifiers: []
    },
    {
      id: 'prod-old-fashioned', categoryId: 'cat-cocteles', name: 'Old Fashioned Ahumado en Roble',
      description: 'Bourbon macerado con corteza de roble, piel de naranja, bitter aromático y humo bajo campana.',
      price: 9.5, image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, badge: 'Firma', allergens: [],
      modifiers: [{ id: 'sweetness', name: 'Dulzura', required: false, options: ['Tradicional', 'Menos azúcar', 'Seco'] }]
    },
    {
      id: 'prod-gin-fogon', categoryId: 'cat-cocteles', name: 'Gin Tonic Botánico El Fogón',
      description: 'Ginebra premium infusionada con bayas de enebro tostadas, pomelo flambeado y tónica premium.',
      price: 8.5, image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, allergens: [], modifiers: []
    },
    {
      id: 'prod-ipa', categoryId: 'cat-bebidas', name: 'Cerveza IPA de Grifo (Pinta)',
      description: 'Cerveza artesanal lupulada servida bien fría desde la barra.',
      price: 4, image: 'https://images.unsplash.com/photo-1608270191993-2777f98be127?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, allergens: [], modifiers: []
    },
    {
      id: 'prod-volcan', categoryId: 'cat-postres', name: 'Volcán de Fuego & Dulce de Leche',
      description: 'Bizcocho tibio relleno de dulce de leche fundido, con helado artesanal de nata.',
      price: 5.5, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=500&auto=format&fit=crop&q=80',
      isAvailable: true, allergens: [], modifiers: []
    }
  ],
  orders: [],
  settings: { ...DEFAULT_SETTINGS }
};

class Database {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
      this.migrate();
      this.save();
    } else {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        this.migrate();
        this.save();
        this.backup('arranque');
      } catch (err) {
        // No sobrescribimos un archivo dañado: lo apartamos y recuperamos la última copia buena
        const broken = DB_FILE.replace(/\.json$/, `.corrupto-${Date.now()}.json`);
        try { fs.copyFileSync(DB_FILE, broken); } catch (_) { /* ignorar */ }
        const recovered = this.loadLatestValidBackup();
        if (recovered) {
          console.error(`⚠️  La base de datos estaba dañada (copia en ${broken}). Recuperada desde la copia de seguridad ${recovered.name}.`);
          this.data = recovered.data;
        } else {
          console.error(`⚠️  La base de datos estaba dañada (copia en ${broken}) y no hay copias de seguridad. Se reinicia con valores iniciales.`, err);
          this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
        }
        this.migrate();
        this.save();
      }
    }
  }

  // Completa campos nuevos en bases de datos antiguas sin perder información
  migrate() {
    const d = this.data;
    d.sectors = d.sectors || INITIAL_DATA.sectors;
    d.tables = d.tables || [];
    d.reservations = d.reservations || [];
    d.categories = d.categories || [];
    d.products = d.products || [];
    d.orders = d.orders || [];
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    if (!d.floor || !d.floor.cols) d.floor = defaultFloor(d.tables);
    if (!Array.isArray(d.sessions)) d.sessions = [];

    d.products.forEach(p => {
      if (!Array.isArray(p.allergens)) p.allergens = [];
      const en = PRODUCT_EN[p.id];
      if (en) {
        if (!p.name_en) p.name_en = en.name_en;
        if (!p.description_en) p.description_en = en.description_en;
      }
    });
    d.categories.forEach(c => {
      const en = CATEGORY_EN[c.id];
      if (en) {
        if (!c.name_en) c.name_en = en.name_en;
        if (!c.description_en) c.description_en = en.description_en;
      }
    });
    // Los tokens QR antiguos ya no se usan
    d.tables.forEach(t => { delete t.qrToken; });
  }

  // ---------------- Copias de seguridad ----------------
  backup(reason = 'manual') {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const name = `db-${stamp}-${String(reason).replace(/[^a-z0-9-]/gi, '')}.json`;
      fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(this.data), 'utf-8');
      // Conservar solo las más recientes
      const files = this.listBackups();
      files.slice(MAX_BACKUPS).forEach(f => { try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (_) { /* ignorar */ } });
      return name;
    } catch (err) {
      console.error('No se pudo crear la copia de seguridad:', err.message);
      return null;
    }
  }

  listBackups() {
    try {
      return fs.readdirSync(BACKUP_DIR)
        .filter(f => /^db-.*\.json$/.test(f))
        .map(f => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: st.size, createdAt: st.mtime.toISOString() };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (_) {
      return [];
    }
  }

  readBackup(name) {
    if (!/^db-[\w-]+\.json$/.test(String(name))) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  loadLatestValidBackup() {
    for (const f of this.listBackups()) {
      const data = this.readBackup(f.name);
      if (Database.isValidData(data)) return { name: f.name, data };
    }
    return null;
  }

  static isValidData(d) {
    return !!d && typeof d === 'object' && Array.isArray(d.tables) && Array.isArray(d.products) &&
      Array.isArray(d.categories) && d.settings && typeof d.settings === 'object';
  }

  // Restaurar datos (de una copia o de un archivo subido). Se conservan el PIN y las sesiones actuales.
  restore(data) {
    if (!Database.isValidData(data)) throw new Error('El archivo no es una copia válida de El Fogón');
    this.backup('antes-de-restaurar');
    const keepPin = this.data.settings?.staffPinHash;
    const keepSessions = this.data.sessions;
    this.data = JSON.parse(JSON.stringify(data));
    this.data.sessions = keepSessions || [];
    this.migrate();
    if (keepPin) this.data.settings.staffPinHash = keepPin;
    else delete this.data.settings.staffPinHash;
    this.save();
  }

  // Copia para descargar (sin sesiones ni PIN cifrado)
  exportData() {
    const copy = JSON.parse(JSON.stringify(this.data));
    delete copy.sessions;
    if (copy.settings) delete copy.settings.staffPinHash;
    return copy;
  }

  // Escritura atómica: si el proceso se corta a mitad, el archivo anterior queda intacto
  save() {
    const json = JSON.stringify(this.data, null, 2);
    const tmp = `${DB_FILE}.tmp`;
    try {
      fs.writeFileSync(tmp, json, 'utf-8');
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      // En Windows el renombrado puede fallar si el antivirus o un editor tiene el archivo abierto:
      // se escribe directamente para no perder el pedido o la reserva.
      fs.writeFileSync(DB_FILE, json, 'utf-8');
      try { fs.unlinkSync(tmp); } catch (_) { /* puede no existir */ }
    }
  }

  getTables() {
    return this.data.tables;
  }

  getTable(idOrNumber) {
    return this.data.tables.find(t => t.id === idOrNumber || t.number === idOrNumber);
  }

  updateTable(id, updates) {
    const idx = this.data.tables.findIndex(t => t.id === id || t.number === id);
    if (idx !== -1) {
      this.data.tables[idx] = { ...this.data.tables[idx], ...updates };
      this.save();
      return this.data.tables[idx];
    }
    return null;
  }

  updateTablePositions(positions) {
    if (Array.isArray(positions)) {
      this.data.tables = positions.map(pos => {
        const existing = this.data.tables.find(t => t.id === pos.id) || {};
        return {
          ...existing,
          ...pos,
          width: pos.width || existing.width || 75,
          height: pos.height || existing.height || 65,
          x: pos.x !== undefined ? pos.x : (existing.x || 50),
          y: pos.y !== undefined ? pos.y : (existing.y || 50),
          shape: pos.shape || existing.shape || 'rect',
          capacity: pos.capacity || existing.capacity || 4,
          status: pos.status || existing.status || 'AVAILABLE'
        };
      });
      this.save();
    }
    return this.data.tables;
  }

  getReservations() {
    return this.data.reservations;
  }

  getReservation(id) {
    return this.data.reservations.find(r => r.id === id) || null;
  }

  addReservation(res) {
    this.data.reservations.unshift(res);
    this.save();
    return res;
  }

  cancelReservation(id) {
    const res = this.data.reservations.find(r => r.id === id);
    if (res) {
      res.status = 'CANCELLED';
      res.cancelledAt = new Date().toISOString();
      const tbl = this.data.tables.find(t => t.id === res.tableId || t.number === res.tableNumber);
      if (tbl && tbl.status === 'RESERVED_SOON') {
        tbl.status = 'AVAILABLE';
      }
      this.save();
      return res;
    }
    return null;
  }

  // RGPD: elimina los datos de contacto de reservas con más de `days` días de antigüedad
  anonymizeOldReservations(days = 180) {
    const limit = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let count = 0;
    this.data.reservations.forEach(r => {
      if (r.date && r.date < limit && !r.anonymized) {
        r.customerName = 'Anonimizado';
        r.customerPhone = '';
        r.notes = '';
        r.anonymized = true;
        count += 1;
      }
    });
    if (count) this.save();
    return count;
  }

  getProducts() {
    return this.data.products;
  }

  updateProduct(id, updates) {
    const prod = this.data.products.find(p => p.id === id);
    if (!prod) return null;
    Object.assign(prod, updates);
    this.save();
    return prod;
  }

  getCategories() {
    return this.data.categories;
  }

  getOrders() {
    return this.data.orders;
  }

  createOrder(orderData) {
    const maxNum = this.data.orders.reduce((m, o) => Math.max(m, parseInt(o.orderNumber, 10) || 0), 141);
    const orderNumber = String(maxNum + 1).padStart(4, '0');
    const newOrder = {
      id: 'ord-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      orderNumber,
      createdAt: new Date().toISOString(),
      status: 'RECEIVED',
      ...orderData
    };
    this.data.orders.unshift(newOrder);

    // Marcar la mesa como ocupada
    const tbl = this.data.tables.find(t => t.id === orderData.tableId || t.number === orderData.tableNumber);
    if (tbl) {
      tbl.status = 'OCCUPIED';
    }

    this.save();
    return newOrder;
  }

  updateOrderStatus(orderId, status) {
    const ord = this.data.orders.find(o => o.id === orderId || o.orderNumber === orderId);
    if (ord) {
      ord.status = status;
      this.save();
      return ord;
    }
    return null;
  }

  // Al liberar una mesa, se cierran sus comandas ya servidas (deja de sumarse su consumo)
  closeServedOrders(table) {
    let changed = false;
    this.data.orders.forEach(o => {
      if ((o.tableId === table.id || o.tableNumber === table.number) && o.status === 'SERVED') {
        o.status = 'CLOSED';
        changed = true;
      }
    });
    if (changed) this.save();
  }

  getSettings() {
    return this.data.settings;
  }

  getSessions() {
    return this.data.sessions || [];
  }

  setSessions(list) {
    this.data.sessions = list;
    this.save();
  }

  getFloor() {
    return this.data.floor;
  }

  updateFloor(floor) {
    this.data.floor = floor;
    this.save();
    return floor;
  }

  updateSettings(updates) {
    this.data.settings = { ...this.data.settings, ...updates };
    this.save();
    return this.data.settings;
  }
}

const instance = new Database();
instance.ALLERGENS = ALLERGENS;
instance.FLOOR_CELL = FLOOR_CELL;
instance.UPLOAD_DIR = UPLOAD_DIR;
instance.DATA_DIR = DATA_DIR;
instance.FLOOR_ELEMENT_TYPES = FLOOR_ELEMENT_TYPES;
module.exports = instance;
