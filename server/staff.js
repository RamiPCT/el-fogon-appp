// Empleados, roles, permisos y registro de actividad (auditoría).
// Los permisos se comprueban SIEMPRE en el servidor (auth.requirePermission).
const crypto = require('crypto');

const ROLES = {
  admin:   { label: 'Administrador', rank: 4 },
  manager: { label: 'Encargado',     rank: 3 },
  waiter:  { label: 'Camarero',      rank: 2 },
  kitchen: { label: 'Cocina',        rank: 1 },
  bar:     { label: 'Barra',         rank: 1 }
};

const PERMISSIONS = {
  'settings.manage':     ['admin'],                 // ajustes del local, PIN, impresora
  'backups.manage':      ['admin'],                 // copias y restauración
  'staff.manage':        ['admin', 'manager'],      // el encargado solo gestiona roles inferiores
  'audit.view':          ['admin', 'manager'],
  'floor.manage':        ['admin', 'manager'],      // plano y mesas
  'menu.manage':         ['admin', 'manager'],      // precios, fotos, altas y bajas
  'menu.availability':   ['admin', 'manager', 'waiter', 'kitchen', 'bar'], // marcar agotado
  'reservations.manage': ['admin', 'manager', 'waiter'],
  'tables.status':       ['admin', 'manager', 'waiter'],
  'orders.view':         ['admin', 'manager', 'waiter', 'kitchen', 'bar'],
  'orders.status':       ['admin', 'manager', 'waiter', 'kitchen', 'bar'],
  'calls.manage':        ['admin', 'manager', 'waiter', 'kitchen', 'bar'],
  'printer.use':         ['admin', 'manager', 'waiter', 'kitchen', 'bar'],
  'printer.test':        ['admin', 'manager']
};

const permissionsOf = (role) => Object.keys(PERMISSIONS).filter(p => PERMISSIONS[p].includes(role));
const can = (role, perm) => !!PERMISSIONS[perm]?.includes(role);

// Acceso con el PIN compartido del local: equivale al administrador
const PIN_IDENTITY = { id: 'pin', name: 'Dueño (PIN)', username: null, role: 'admin', active: true };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(test, expected);
}

// Contraseña ficticia para que un usuario inexistente tarde lo mismo (no revela qué usuarios existen)
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

const publicEmployee = (e) => e && ({
  id: e.id, name: e.name, username: e.username, role: e.role, roleLabel: ROLES[e.role]?.label || e.role,
  active: !!e.active, createdAt: e.created_at, updatedAt: e.updated_at, lastLoginAt: e.last_login_at
});

function createStaff(db) {
  const sql = db.sql;
  const q = {
    all: sql.prepare('SELECT * FROM employees ORDER BY active DESC, name COLLATE NOCASE'),
    byId: sql.prepare('SELECT * FROM employees WHERE id = ?'),
    byUser: sql.prepare('SELECT * FROM employees WHERE username = ?'),
    insert: sql.prepare('INSERT INTO employees (id, name, username, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'),
    update: sql.prepare('UPDATE employees SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?'),
    setPw: sql.prepare('UPDATE employees SET password_hash = ?, updated_at = ? WHERE id = ?'),
    login: sql.prepare('UPDATE employees SET last_login_at = ? WHERE id = ?'),
    activeAdmins: sql.prepare("SELECT count(*) AS n FROM employees WHERE role = 'admin' AND active = 1"),
    audit: sql.prepare('INSERT INTO audit_log (at, employee_id, employee_name, action, entity, entity_id, before, after, result, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  };
  const now = () => new Date().toISOString();

  // Identidad a partir del id guardado en la sesión
  function resolve(id) {
    if (!id || id === 'pin') return PIN_IDENTITY;
    const e = q.byId.get(id);
    if (!e) return null;
    return { id: e.id, name: e.name, username: e.username, role: e.role, active: !!e.active };
  }

  function authenticate(username, password) {
    const e = q.byUser.get(String(username || '').trim());
    const ok = checkPassword(String(password || ''), e ? e.password_hash : DUMMY_HASH);
    if (!e || !ok || !e.active) return null;
    q.login.run(now(), e.id);
    return resolve(e.id);
  }

  const list = () => q.all.all().map(publicEmployee);

  function validate({ name, username, role, password }, { isNew }) {
    if (!String(name || '').trim()) return 'Indica el nombre';
    if (isNew && !/^[a-z0-9._-]{3,30}$/i.test(String(username || ''))) return 'El usuario debe tener entre 3 y 30 letras, números, puntos o guiones (sin espacios)';
    if (role !== undefined && !ROLES[role]) return 'Rol no válido';
    if ((isNew || password) && String(password || '').length < 6) return 'La contraseña debe tener al menos 6 caracteres';
    return null;
  }

  // El encargado no puede crear ni tocar administradores ni otros encargados
  const mayManage = (actor, targetRole) => actor.role === 'admin' || ROLES[targetRole]?.rank < ROLES[actor.role]?.rank;

  function create(actor, body) {
    const err = validate(body, { isNew: true });
    if (err) return { error: err, status: 400 };
    if (!mayManage(actor, body.role)) return { error: 'No puedes crear usuarios con ese rol', status: 403 };
    if (q.byUser.get(String(body.username).trim())) return { error: 'Ese usuario ya existe', status: 409 };
    const id = 'emp-' + crypto.randomUUID().slice(0, 8);
    const t = now();
    q.insert.run(id, String(body.name).trim().slice(0, 60), String(body.username).trim().toLowerCase(), hashPassword(body.password), body.role, t, t);
    return { employee: publicEmployee(q.byId.get(id)) };
  }

  function update(actor, id, body) {
    const e = q.byId.get(id);
    if (!e) return { error: 'Empleado no encontrado', status: 404 };
    const role = body.role ?? e.role;
    const err = validate({ name: body.name ?? e.name, role, password: body.password }, { isNew: false });
    if (err) return { error: err, status: 400 };
    if (!mayManage(actor, e.role) || !mayManage(actor, role)) return { error: 'No puedes modificar a este usuario', status: 403 };
    const active = body.active === undefined ? !!e.active : !!body.active;
    if (e.role === 'admin' && e.active && (role !== 'admin' || !active) && q.activeAdmins.get().n <= 1 && !db.getSettings().allowPinLogin) {
      return { error: 'Debe quedar al menos un administrador activo (o el acceso con PIN activado)', status: 409 };
    }
    if (actor.id === id && !active) return { error: 'No puedes desactivarte a ti mismo', status: 409 };
    const t = now();
    q.update.run(String(body.name ?? e.name).trim().slice(0, 60), role, active ? 1 : 0, t, id);
    if (body.password) q.setPw.run(hashPassword(body.password), t, id);
    return { employee: publicEmployee(q.byId.get(id)), before: publicEmployee(e), revokeSessions: !active || !!body.password || role !== e.role };
  }

  const activeAdminCount = () => q.activeAdmins.get().n;

  // ---------------- Auditoría (solo se añaden registros) ----------------
  function audit(req, action, { entity = null, entityId = null, before, after, result = 'ok' } = {}) {
    try {
      const who = req?.staff || null;
      const j = (v) => (v === undefined ? null : JSON.stringify(v).slice(0, 20000));
      q.audit.run(now(), who?.id || null, who?.name || null, action, entity, entityId == null ? null : String(entityId), j(before), j(after), result, req?.ip || null);
    } catch (err) {
      console.error('No se pudo registrar la actividad:', err.message);
    }
  }

  function auditList({ limit = 100, beforeId, entity, entityId, employeeId, action } = {}) {
    const where = [];
    const args = [];
    if (beforeId) { where.push('id < ?'); args.push(Number(beforeId)); }
    if (entity) { where.push('entity = ?'); args.push(String(entity)); }
    if (entityId) { where.push('entity_id = ?'); args.push(String(entityId)); }
    if (employeeId) { where.push('employee_id = ?'); args.push(String(employeeId)); }
    if (action) { where.push('action LIKE ?'); args.push(`${String(action)}%`); }
    const sqlText = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    args.push(Math.min(500, Math.max(1, Number(limit) || 100)));
    return sql.prepare(sqlText).all(...args).map(r => ({
      id: r.id, at: r.at, employeeId: r.employee_id, employeeName: r.employee_name, action: r.action,
      entity: r.entity, entityId: r.entity_id, result: r.result, ip: r.ip,
      before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null
    }));
  }

  return { resolve, authenticate, list, create, update, audit, auditList, activeAdminCount };
}

module.exports = { ROLES, PERMISSIONS, permissionsOf, can, PIN_IDENTITY, createStaff, hashPassword };
