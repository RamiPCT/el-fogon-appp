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
    const text = this.formatTicket(order, settings);
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

  async printOrder(order, settings) {
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

    if (!settings.printerEnabled) {
      printJob.status = 'SIMULATED_SUCCESS';
      console.log('🖨️ [Impresora Térmica - MODO SIMULADO]');
      console.log(formattedText);
      return printJob;
    }

    // Intento de conexión por socket TCP (puerto 9100) a impresora física
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2500);

      socket.connect(settings.printerPort || 9100, settings.printerIp, () => {
        try {
          const buffer = this.generateEscPosBuffer(order, settings);
          socket.write(buffer, () => {
            printJob.status = 'PRINTED';
            console.log(`🖨️ [Impresora Térmica] Ticket #${order.orderNumber} impreso con éxito en ${settings.printerIp}`);
            socket.destroy();
            resolve(printJob);
          });
        } catch (err) {
          printJob.status = 'ERROR';
          printJob.error = err.message;
          socket.destroy();
          resolve(printJob);
        }
      });

      socket.on('error', (err) => {
        console.warn(`⚠️ [Impresora Térmica] No se pudo conectar a ${settings.printerIp}:${settings.printerPort} (${err.message}). Ticket simulado guardado.`);
        printJob.status = 'SIMULATED_LOCAL';
        printJob.error = `No conectada físicamente: ${err.message}`;
        socket.destroy();
        resolve(printJob);
      });

      socket.on('timeout', () => {
        printJob.status = 'SIMULATED_LOCAL';
        printJob.error = 'Timeout de conexión a la impresora de red';
        socket.destroy();
        resolve(printJob);
      });
    });
  }

  getHistory() {
    return this.printHistory;
  }
}

module.exports = new ThermalPrinterService();
