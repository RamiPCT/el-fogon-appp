import React, { useState } from 'react';
import { MessageSquare, Users, Clock, Calendar, Check, X, Phone, User, CircleCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { api } from '../utils/api';
import { todayStr, prettyDate, clockNow } from '../utils/time';

// Hora por defecto: 21:00, o la siguiente media hora si ya es más tarde
const defaultTime = () => {
  const [h, m] = clockNow().split(':').map(Number);
  const next = h * 60 + m + 30;
  const rounded = Math.ceil(next / 30) * 30;
  if (rounded <= 21 * 60) return '21:00';
  if (rounded >= 24 * 60) return '23:30';
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};

// Se monta solo cuando está abierto (así los hooks siempre se ejecutan en el mismo orden)
export const WhatsAppBookingModal = ({ table, onClose, onBookingSuccess, initial = null }) => {
  const { t, lang } = useI18n();
  const today = todayStr();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [guests, setGuests] = useState(initial?.guests || Math.min(table.capacity || 2, 12));
  const [date, setDate] = useState(initial?.date || today);
  const [time, setTime] = useState(initial?.time || defaultTime);
  const [editWhen, setEditWhen] = useState(!initial);
  const [notes, setNotes] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(null); // { reservation, whatsAppUrl }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError(t('book.errName'));
    if (!privacy) return setError(t('book.errPrivacy'));

    setIsSubmitting(true);
    try {
      const data = await api('/api/reservations', {
        method: 'POST',
        body: {
          tableId: table.id,
          tableNumber: table.number,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          guests: Number(guests),
          date,
          startTime: time,
          notes: notes.trim(),
          privacyAccepted: true
        }
      });
      setDone(data);
      onBookingSuccess && onBookingSuccess(data.reservation);
      // Intento de abrir WhatsApp directamente (algunos navegadores lo bloquean: queda el botón)
      if (data.whatsAppUrl) window.open(data.whatsAppUrl, '_blank', 'noopener');
    } catch (err) {
      setError(err.status ? err.message : t('book.errConn'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls = 'w-full bg-[#121212] border border-stone-700 rounded-xl px-3 py-2 text-stone-200 focus:border-[#C8A45D] outline-none';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="book-title">
      <div className="fogon-sheet relative bg-[#1A1A1A] border border-[#C8A45D]/50 border-b-0 sm:border-b rounded-t-3xl sm:rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto fogon-safe-bottom">
        <div className="mx-auto w-10 h-1 rounded-full bg-stone-700 sm:hidden" />

        <div className="flex justify-between items-center pb-2 border-b border-stone-800">
          <div>
            <h3 id="book-title" className="font-display text-sm font-bold text-[#C8A45D]">{t('book.title', { n: table.number })}</h3>
            <p className="text-xs text-stone-400">{t('book.capacity', { n: table.capacity })}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-stone-800 text-stone-400 hover:text-white flex items-center justify-center"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          /* ---------- Reserva registrada ---------- */
          <div className="text-center space-y-3 py-2">
            <CircleCheck className="w-12 h-12 text-green-500 mx-auto" />
            <h4 className="font-display text-base font-bold text-green-400">{t('book.doneTitle')}</h4>
            <p className="text-xs text-stone-300 font-mono">
              {t('book.summary', {
                date: prettyDate(done.reservation.date, lang),
                time: done.reservation.startTime,
                guests: done.reservation.guests,
                table: done.reservation.tableNumber
              })}
            </p>
            <p className="text-xs text-stone-400 leading-relaxed">
              {done.whatsAppUrl ? t('book.doneText') : t('book.noWa')}
            </p>
            {done.whatsAppUrl && (
              <a
                href={done.whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-lg"
              >
                <MessageSquare className="w-4 h-4" />
                {t('book.openWa')}
              </a>
            )}
            <button onClick={onClose} className="w-full py-2.5 bg-[#121212] border border-stone-700 text-stone-300 hover:text-white text-xs font-semibold rounded-xl">
              {t('common.close')}
            </button>
          </div>
        ) : (
          /* ---------- Formulario ---------- */
          <form onSubmit={handleSubmit} className="space-y-3 text-xs" noValidate>
            <div>
              <label htmlFor="bk-name" className="text-stone-300 mb-1 font-medium flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('book.name')}
              </label>
              <input id="bk-name" type="text" required autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('book.namePh')} className={inputCls} />
            </div>

            <div>
              <label htmlFor="bk-phone" className="text-stone-300 mb-1 font-medium flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('book.phone')}
              </label>
              <input id="bk-phone" type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('book.phonePh')} className={inputCls} />
            </div>

            {!editWhen ? (
              <div className="flex items-center justify-between gap-2 bg-[#14281D] border border-[#C8A45D]/50 rounded-xl px-3 py-2.5">
                <span className="font-mono text-[#E6C687] font-bold">
                  📅 {prettyDate(date, lang)} · {time} h · 👥 {guests}
                </span>
                <button type="button" onClick={() => setEditWhen(true)} className="text-[11px] text-stone-300 underline shrink-0">{t('book.change')}</button>
              </div>
            ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3 sm:col-span-1">
                <label htmlFor="bk-date" className="text-stone-300 mb-1 font-medium flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('book.date')}
                </label>
                <input id="bk-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} px-2`} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="bk-time" className="text-stone-300 mb-1 font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('book.time')}
                </label>
                <input id="bk-time" type="time" step="900" value={time} onChange={(e) => setTime(e.target.value)} className={`${inputCls} px-2`} />
              </div>
              <div>
                <label htmlFor="bk-guests" className="text-stone-300 mb-1 font-medium flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[#C8A45D]" /> {t('book.guests')}
                </label>
                <input id="bk-guests" type="number" min="1" max="20" value={guests} onChange={(e) => setGuests(e.target.value)} className={`${inputCls} px-2`} />
              </div>
            </div>
            )}

            <div>
              <label htmlFor="bk-notes" className="block text-stone-400 mb-1 font-medium">{t('book.notes')}</label>
              <input id="bk-notes" type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('book.notesPh')} className={`${inputCls} text-[11px]`} />
            </div>

            <div className="p-3 bg-[#14281D] border border-[#C8A45D]/40 rounded-xl text-[11px] space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[#C8A45D]">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{t('book.waTitle')}</span>
              </div>
              <p className="text-stone-300 leading-tight">{t('book.waText')}</p>
            </div>

            <label className="flex items-start gap-2 text-[11px] text-stone-300 cursor-pointer">
              <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 accent-[#C8A45D]" />
              <span>
                {t('book.privacyPre')}{' '}
                <a href="/privacidad" target="_blank" rel="noopener noreferrer" className="text-[#C8A45D] underline">{t('book.privacyLink')}</a>.
              </span>
            </label>

            {error && <p className="text-[11px] text-red-400 font-semibold" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-[#C8A45D] hover:bg-amber-400 text-[#121212] font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-lg disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? t('book.sending') : t('book.submit')}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
