# El Fogón · Integraciones externas y normativa

Estado verificado el 23/11/2026. Nada de lo que aparece aquí está activado: cada integración necesita credenciales o decisiones del dueño.

## Facturación y Veri*Factu

- Las fechas publicadas en el BOE (Real Decreto-ley 15/2025) siguen siendo: **1 de enero de 2027** para sociedades (Impuesto sobre Sociedades) y **1 de julio de 2027** para autónomos y resto de obligados.
- El 5 de octubre de 2026 Hacienda **anunció** un nuevo aplazamiento a **octubre de 2028**, para alinearlo con la factura electrónica. Mientras no se publique en el BOE, hay que planificar con las fechas de 2027. Hacienda ha indicado que los requisitos técnicos (integridad, trazabilidad, inalterabilidad) se mantienen.
- Consecuencia para el diseño: el módulo de facturación se diseña desde el principio con registros encadenados por hash, numeración correlativa por serie y documentos inalterables. **No se afirmará que cumple** el RD 1007/2023 hasta verificar los requisitos completos (formato de registros, QR tributario, envío a la AEAT o modo no-Veri*Factu, declaración responsable del productor del software).
- Hacer el programa de facturación propio convierte a quien lo desarrolla en «productor» del sistema informático de facturación, con obligaciones propias. Alternativa: mantener el TPV fiscal que tenga el local y usar El Fogón para la operativa (pedidos, cocina, caja interna).

**Necesito del dueño:** ¿el titular es sociedad o autónomo? ¿El local ya tiene un TPV o caja registradora con la que emite tickets? ¿Quiere que El Fogón emita los documentos fiscales?

Fuentes: [RDL 15/2025 (resumen RSM, enlaza al BOE)](https://www.rsm.global/spain/sites/default/files/media/VeriFactu%20aplazado%20hasta%202027.pdf) · [Anuncio de aplazamiento a 2028](https://loentiendo.com/aplazamiento-verifactu-2028/) · [Fechas vigentes mientras no haya BOE](https://getrenn.com/es/blog/verifactu-aplazado)

## Pagos con tarjeta

- Propuesta (D5): seguir con el datáfono del banco y registrar en el TPV que el pago fue con tarjeta. No se simula ninguna pasarela.
- Integrar el datáfono o una pasarela (Redsys, Stripe Terminal, SumUp…) requiere contrato con el proveedor, credenciales y comisiones. Se deja preparada la tabla `payments` con `method` y referencia externa.

## Reseñas de Google (Google Business Profile API)

- La API oficial permite listar las reseñas de una ficha verificada (valoración, texto, fecha, autor y respuesta) y responderlas. Requiere OAuth con el permiso de gestión del negocio.
- **No es pública**: hay que pedir acceso para un proyecto de Google Cloud; Google revisa la solicitud (unos 14 días) y solo da acceso a fichas que gestione la cuenta autorizada.
- Diseño: sincronización periódica (no instantánea) desde el servidor, guardada en la base de datos, con fecha de última sincronización y errores visibles en el panel. Sin scraping.

**Decisión del dueño (23/11):** se hará cuando la web esté publicada. Entonces hará falta acceso de administrador a la ficha de Google y un proyecto de Google Cloud para solicitar la API.

Fuentes: [Requisitos de acceso](https://developers.google.com/my-business/content/prereqs) · [Preguntas frecuentes](https://developers.google.com/my-business/content/faq) · [Método reviews.list](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)

## WhatsApp

- **Hoy (gratis):** enlaces `wa.me` con el mensaje ya escrito; el cliente o el personal pulsa «enviar». Se mantiene.
- **Automático (WhatsApp Business Platform / Cloud API de Meta):** permite enviar confirmaciones y avisos sin intervención, pero **cada plantilla tiene coste por mensaje**. Para España, mensajes de utilidad (confirmaciones) ≈ 0,0166 € y de marketing ≈ 0,0509 € (tarifas 2026). Desde el 1 de octubre de 2026 Meta cobra también las de utilidad dentro de la ventana de 24 h. Requiere cuenta de Meta Business verificada, un número dedicado y plantillas aprobadas.

**Decisión del dueño (23/11):** sin coste por ahora. La reserva se guarda sola, el cliente confirma enviando el WhatsApp ya escrito y el local recibe el aviso en el KDS y el panel sin tener que responder. Si más adelante se quiere enviar mensajes automáticos, hará falta cuenta de Meta Business y número dedicado.

Fuentes: [Precios oficiales de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [Tarifas España](https://whautomate.com/whatsapp-business-api-pricing-spain) · [Cambio del 1/10/2026](https://help.sleekflow.io/en_US/pricing)

## Impresora térmica

- ESC/POS por red (TCP 9100) desde el servidor. Con el servidor en el ordenador del local funciona directamente.
- Por este protocolo la impresora **no confirma** que el papel haya salido: `SENT` significa «la impresora aceptó los datos». `FAILED` y `DISABLED` nunca se cuentan como impresos.
- Si el servidor se publica en la nube, no verá la impresora de la red del local: hará falta un agente local (pequeño programa en el ordenador del local que recibe los tickets y los envía a la impresora).
