import React, { useState, useEffect } from 'react';
import { CircleCheck, Trash2, MessageSquare } from 'lucide-react';
import { useI18n } from '../i18n';
import { api } from '../utils/api';
import { prettyDate } from '../utils/time';

export const CancelReservation = ({ reservationId, onBack }) => {
  const { t, lang } = useI18n();
  const [reservation, setReservation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelledData, setCancelledData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/reservations/${encodeURIComponent(reservationId || '')}`)
      .then(setReservation)
      .catch(() => setReservation(null))
      .finally(() => setLoading(false));
  }, [reservationId]);

  const handleConfirmCancel = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/reservations/${encodeURIComponent(reservationId)}`, { method: 'DELETE' });
      setCancelledData(data);
      if (data.whatsAppUrl) window.open(data.whatsAppUrl, '_blank', 'noopener');
    } catch (err) {
      setError(`${t('cancel.error')}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs text-stone-400">{t('cancel.loading')}</div>;
  }

  if (cancelledData) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <div className="bg-[#1A1A1A] border border-green-600 rounded-2xl p-6 text-center space-y-3 shadow-2xl">
          <CircleCheck className="w-12 h-12 text-green-500 mx-auto" />
          <h1 className="font-display text-base font-bold text-green-400">{t('cancel.done')}</h1>
          <p className="text-xs text-stone-300">{t('cancel.doneText', { n: cancelledData.cancelled.tableNumber })}</p>
          {cancelledData.whatsAppUrl && (
            <a
              href={cancelledData.whatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4" /> {t('cancel.notify')}
            </a>
          )}
          <button onClick={onBack} className="px-4 py-2 bg-[#C8A45D] text-[#121212] font-bold text-xs rounded-xl">
            {t('cancel.back')}
          </button>
        </div>
      </div>
    );
  }

  if (!reservation || reservation.status !== 'CONFIRMED') {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4 text-center">
        <p className="text-xs text-stone-400">
          {reservation && reservation.status === 'CANCELLED' ? t('cancel.already') : t('cancel.notFound')}
        </p>
        <button onClick={onBack} className="text-xs text-[#C8A45D] underline">{t('cancel.back')}</button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="bg-[#1A1A1A] border border-red-900/60 rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-950/80 text-red-400 border border-red-800 flex items-center justify-center">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-sm font-bold text-red-300">{t('cancel.title')}</h1>
            {reservation.customerName && (
              <p className="text-xs text-stone-400">{t('cancel.hi', { name: reservation.customerName })}</p>
            )}
          </div>
        </div>

        <dl className="bg-[#121212] p-3.5 rounded-xl border border-stone-800 text-xs text-stone-300 space-y-1">
          <div className="flex gap-1"><dt className="font-bold">{t('cancel.when')}:</dt><dd>{prettyDate(reservation.date, lang)} · {reservation.startTime} h</dd></div>
          <div className="flex gap-1"><dt className="font-bold">{t('cancel.guests')}:</dt><dd>{reservation.guests}</dd></div>
          <div className="flex gap-1"><dt className="font-bold">{t('cancel.table')}:</dt><dd>{reservation.tableNumber}</dd></div>
          <p className="text-[11px] text-stone-400 pt-1">{t('cancel.text')}</p>
        </dl>

        {error && <p className="text-[11px] text-red-400" role="alert">{error}</p>}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={onBack}
            className="py-2.5 bg-[#121212] border border-stone-700 text-stone-300 hover:text-white text-xs font-semibold rounded-xl"
          >
            {t('cancel.keep')}
          </button>
          <button
            onClick={handleConfirmCancel}
            disabled={busy}
            className="py-2.5 bg-red-800 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-lg disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('cancel.confirm')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
