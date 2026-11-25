import React from 'react';
import { ArrowLeft, Scale } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useI18n } from '../i18n';

// Plantillas legales básicas para un restaurante en España (LSSI-CE y RGPD).
// Los datos del titular se editan en Admin → Ajustes. Revisadlas con un asesor antes de publicar.

const Pending = ({ label }) => (
  <span className="bg-amber-500/20 text-amber-300 border border-amber-600/50 rounded px-1">[pendiente: {label}]</span>
);

const H = ({ children }) => <h2 className="font-display text-base font-bold text-[#C8A45D] pt-4">{children}</h2>;
const P = ({ children }) => <p className="text-sm text-stone-300 leading-relaxed">{children}</p>;

export const LegalPage = ({ type, onNavigate }) => {
  const s = useSettings();
  const { lang, t } = useI18n();

  const holder = s.legalName || <Pending label="razón social o nombre del titular" />;
  const nif = s.nif || <Pending label="NIF/CIF" />;
  const address = s.address
    ? [s.address, [s.postalCode, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : <Pending label="domicilio" />;
  const email = s.email
    ? <a href={`mailto:${s.email}`} className="text-[#C8A45D] underline">{s.email}</a>
    : <Pending label="email de contacto" />;
  const site = typeof window !== 'undefined' ? window.location.host : '';

  const titles = { legal: 'Aviso legal', privacy: 'Política de privacidad', cookies: 'Política de cookies' };

  return (
    <article className="max-w-2xl mx-auto px-5 py-8 space-y-3">
      <button onClick={() => onNavigate('/')} className="text-xs text-stone-400 hover:text-[#C8A45D] inline-flex items-center gap-1">
        <ArrowLeft className="w-3.5 h-3.5" /> {t('common.back')}
      </button>

      <h1 className="font-display text-2xl font-bold text-[#F4EFE6] flex items-center gap-2">
        <Scale className="w-5 h-5 text-[#C8A45D]" /> {titles[type]}
      </h1>

      {lang === 'en' && (
        <p className="text-xs text-stone-400 italic">This legal information is provided in Spanish, as required by Spanish law. Contact us if you need help understanding it.</p>
      )}

      {type === 'legal' && (
        <>
          <H>Datos identificativos</H>
          <P>
            En cumplimiento del artículo 10 de la Ley 34/2002, de Servicios de la Sociedad de la Información y de Comercio
            Electrónico (LSSI-CE), se informa de que este sitio web ({site}) es titularidad de {holder}, con NIF {nif} y domicilio
            en {address}. Contacto: {email}.
          </P>
          <H>Objeto</H>
          <P>
            Este sitio web ofrece información sobre el restaurante El Fogón, su carta, la posibilidad de solicitar reservas y de
            realizar pedidos desde la mesa dentro del local.
          </P>
          <H>Condiciones de uso</H>
          <P>
            El acceso a la web es libre y gratuito. La persona usuaria se compromete a hacer un uso adecuado de los contenidos
            y a no emplearlos para actividades ilícitas. Los precios mostrados incluyen IVA. Las reservas quedan sujetas a la
            confirmación del local.
          </P>
          <H>Propiedad intelectual</H>
          <P>
            La marca El Fogón, su logotipo y los contenidos propios de esta web pertenecen a su titular. Queda prohibida su
            reproducción sin autorización expresa.
          </P>
          <H>Responsabilidad</H>
          <P>
            El titular no se hace responsable de los daños derivados de interrupciones del servicio o de un uso indebido de la
            web. Los enlaces a sitios de terceros (WhatsApp, Google Maps, Instagram) se rigen por sus propias condiciones.
          </P>
          <H>Legislación aplicable</H>
          <P>Estas condiciones se rigen por la legislación española.</P>
        </>
      )}

      {type === 'privacy' && (
        <>
          <H>Responsable del tratamiento</H>
          <P>{holder} · NIF {nif} · {address} · {email}</P>

          <H>Qué datos tratamos y para qué</H>
          <P>
            <strong>Reservas:</strong> nombre, teléfono (opcional), fecha, hora, número de personas y las notas que nos indiques,
            para gestionar tu reserva y contactarte sobre ella.
          </P>
          <P>
            <strong>Pedidos desde la mesa:</strong> número de mesa y productos elegidos, para preparar y servir tu pedido.
            No pedimos datos personales para pedir.
          </P>

          <H>Base jurídica</H>
          <P>
            La gestión de tu reserva o pedido a petición tuya (art. 6.1.b del RGPD) y tu consentimiento al enviar el formulario
            (art. 6.1.a del RGPD).
          </P>

          <H>Cuánto tiempo los conservamos</H>
          <P>
            Los datos de contacto de las reservas se eliminan automáticamente 6 meses después de la fecha de la reserva. Los pedidos
            se conservan sin datos personales con fines contables durante los plazos que exige la ley.
          </P>

          <H>Con quién se comparten</H>
          <P>
            No cedemos tus datos a terceros. Si eliges confirmar tu reserva por WhatsApp, el mensaje lo envías tú desde tu cuenta
            y se rige por la política de privacidad de WhatsApp (Meta). Nuestro proveedor de alojamiento web trata los datos
            únicamente por cuenta nuestra.
          </P>

          <H>Tus derechos</H>
          <P>
            Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {email}.
            Si consideras que no hemos atendido correctamente tu solicitud, puedes presentar una reclamación ante la Agencia Española
            de Protección de Datos (<a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer" className="text-[#C8A45D] underline">www.aepd.es</a>).
          </P>
        </>
      )}

      {type === 'cookies' && (
        <>
          <H>¿Usamos cookies?</H>
          <P>
            Esta web no utiliza cookies de publicidad ni de análisis. Solo guarda en tu navegador (almacenamiento local) la
            información técnica imprescindible para funcionar, que no requiere consentimiento según el artículo 22.2 de la LSSI-CE:
          </P>
          <ul className="text-sm text-stone-300 list-disc pl-5 space-y-1">
            <li><code className="text-[#E6C687]">fogon_lang</code>: idioma elegido (español o inglés).</li>
            <li><code className="text-[#E6C687]">fogon_cookie_notice</code>: recuerda que ya has visto este aviso.</li>
            <li><code className="text-[#E6C687]">fogon_staff_token</code>: sesión del personal del local (solo para empleados).</li>
          </ul>

          <H>Contenido de terceros</H>
          <P>
            Para mostrar las tipografías se cargan fuentes desde Google Fonts y algunas fotografías desde Unsplash; al hacerlo,
            tu navegador se conecta a sus servidores. Los enlaces a WhatsApp, Google Maps o Instagram solo se abren si los pulsas.
          </P>

          <H>Cómo borrar estos datos</H>
          <P>Puedes eliminarlos en cualquier momento desde la configuración de tu navegador (borrar datos del sitio).</P>
        </>
      )}

      <p className="text-[11px] text-stone-400 pt-6">Última actualización: noviembre de 2026</p>
    </article>
  );
};
