const net = require('net');
const time = require('./time');

let iconv = null;
try { iconv = require('iconv-lite'); } catch (_) { /* opcional */ }

class ThermalPrinterService {
  constructor() {
    this.printHistory = [];
  }

  formatTicket(order, settings) {
    const divider = '------------------------------------------------';
    const doubleDivider = '================================================';
    const zone = (settings && settings.timezone) || time.DEFAULT_TZ;
    const timeStr = time.formatTime(order.createdAt, zone);
    const dateStr = time.formatDate(order.createdAt, zone);

    let lines = [];
    lines.push(doubleDivider);
    lines.push('                   EL FOGÓN');
    lines.push('        PICOTEO & COCTELERÍA DE AUTOR');
    lines.push(doubleDivider);
    lines.push(`COMANDA: #${order.orderNumber}          FECHA: ${dateStr} ${timeStr}`);
    lines.push(`MESA: ${order.tableNumber || order.tableId}             TIPO: SALÓN`);
    lines.push(divider);
    lines.push('CANT.  DESCRIPCIÓN                        TOTAL');
    lines.push(divider);

    let total = 0;
    (order.items || []).forEach(item => {
      const lineTotal = (item.price || 0) * (item.quantity || 1);
      total += lineTotal;
      const qty = `${item.quantity}x`.padEnd(6);
      const name = item.name.length > 28 ? item.name.substring(0, 28) : item.name.padEnd(28);
      const price = `${lineTotal.toFixed(2).replace('.', ',')} €`.padStart(14);
      lines.push(`${qty}${name}${price}`);

      if (item.modifiers && Object.keys(item.modifiers).length > 0) {
        Object.entries(item.modifiers).forEach(([k, v]) => {
          lines.push(`       * ${k}: ${v}`);
        });
      }
      if (item.notes) {
        lines.push(`       > NOTA: ${item.notes}`);
      }
    });

    lines.push(divider);
    lines.push(`TOTAL:${`${total.toFixed(2).replace('.', ',')} €`.padStart(42)}`);
    lines.push(doubleDivider);
    lines.push('           [ PEDIDO DESDE LA MESA ]');
    lines.push('          Muchas gracias por su visita');
    lines.push('\n\n\n'); // Espacio para el corte

    return lines.join('\n');
  }

  // Genera comandos binarios ESC/POS estándar
  generateEscPosBuffer(order, settings) {
    return this.textToEscPos(this.formatTicket(order, settings));
  }

  // Texto plano (48 columnas) → comandos ESC/POS
  textToEscPos(text) {
    const ESC = '\x1b';
    const GS = '\x1d';
    
    // Inicializar impresora, tabla de caracteres PC858 (acentos, ñ y €), negrita, cortar papel
    const init = Buffer.from(`${ESC}@`, 'ascii');
    const codePage = iconv ? Buffer.from(`${ESC}t\x13`, 'ascii') : Buffer.alloc(0);
    const boldOn = Buffer.from(`${ESC}E\x01`, 'ascii');
    const body = iconv ? iconv.encode(text, 'cp858') : Buffer.from(text, 'utf-8');
    const cut = Buffer.from(`${GS}V\x41\x00`, 'ascii'); // Corte total

    return Buffer.concat([init, codePage, boldOn, body, cut]);
  }

  // retry: reintenta si la impresora no responde (pedidos automáticos)
  async printOrder(order, settings, { retry = false } = {}) {
    const formattedText = this.formatTicket(order, settings);
    const printJob = {
      id: 'print-' + Date.now(),
      orderId: order.id,
      orderNumber: order.orderNumber,
      timestamp: new Date().toISOString(),
      ticketText: formattedText,
      status: 'QUEUED',
      error: null
    };

    this.printHistory.unshift(printJob);
    if (this.printHistory.length > 200) this.printHistory.length = 200;

    // Impresión desactivada en Ajustes: NO es un éxito, solo queda registrado
    if (!settings.printerEnabled) {
      printJob.status = 'DISABLED';
      console.log('🖨️ [Impresora desactivada] Ticket no impreso:\n' + formattedText);
      return printJob;
    }

    // Hasta 3 intentos solo si NO se llegó a conectar (así nunca se imprime dos veces)
    const delays = retry ? [0, 2000, 5000] : [0];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
      printJob.attempts = i + 1;
      const r = await this.sendToPrinter(this.generateEscPosBuffer(order, settings), settings);
      printJob.status = r.status;
      printJob.error = r.error || null;
      if (r.status !== 'FAILED' || r.connected) break;
    }
    if (printJob.status === 'SENT') {
      console.log(`🖨️ [Impresora] Ticket #${order.orderNumber} enviado a ${settings.printerIp}`);
    } else {
      console.warn(`⚠️ [Impresora] Ticket #${order.orderNumber} NO impreso: ${printJob.error}`);
    }
    return printJob;
  }

  // Envía el ticket por TCP (ESC/POS, puerto 9100).
  // SENT = la impresora aceptó los datos. Por este protocolo la impresora no confirma
  // que el papel haya salido, así que no se puede garantizar más que eso.
  // Imprime un texto (ticket de cuenta, factura, cierre de caja). Sin reintentos.
  async printText(text, settings, label = 'Ticket') {
    if (!settings.printerEnabled) return { status: 'DISABLED', label };
    const r = await this.sendToPrinter(this.textToEscPos(text), settings);
    return { status: r.status, error: r.error || null, label };
  }

  sendToPrinter(buffer, settings) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let connected = false;
      let done = false;
      const finish = (res) => { if (done) return; done = true; socket.destroy(); resolve({ ...res, connected }); };
      socket.setTimeout(2500);
      socket.connect(settings.printerPort || 9100, settings.printerIp, () => {
        connected = true;
        try {
          socket.write(buffer, (err) => {
            finish(err ? { status: 'FAILED', error: `Error al enviar: ${err.message}` } : { status: 'SENT' });
          });
        } catch (err) {
          finish({ status: 'FAILED', error: err.message });
        }
      });
      socket.on('error', (err) => finish({ status: 'FAILED', error: `No se pudo conectar con ${settings.printerIp}:${settings.printerPort || 9100} (${err.message})` }));
      socket.on('timeout', () => finish({ status: 'FAILED', error: connected ? 'La impresora dejó de responder' : 'La impresora no responde (tiempo agotado)' }));
    });
  }

  getHistory() {
    return this.printHistory;
  }
}

module.exports = new ThermalPrinterService();
