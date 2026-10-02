import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { submitReport, type ReportKind } from '../lib/platform';

export const REPORT_REASONS = [
  'Contenido inapropiado',
  'Contenido sin consentimiento',
  'Violación de derechos de autor',
  'Spam o fraude',
  'Menores de edad',
  'Otro',
];

interface Props {
  kind: ReportKind;
  targetId?: string;
  targetLabel: string;
  onClose: () => void;
}

const ReportDialog: React.FC<Props> = ({ kind, targetId, targetLabel, onClose }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const send = async () => {
    const result = await submitReport(user, { kind, targetId, targetLabel, reason, description, contactEmail: email });
    if (!result.ok) return setError(result.error || 'No se pudo enviar el reporte');
    setDone(true);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Reportar">
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        {done ? (
          <div className="text-center py-4">
            <i aria-hidden="true" className="fas fa-check-circle text-4xl text-green-500 mb-3"></i>
            <h3 className="text-lg font-bold text-gray-900">Reporte enviado</h3>
            <p className="text-sm text-gray-600 mt-2">Nuestro equipo de moderación lo revisará. Gracias por ayudarnos a mantener la comunidad segura.</p>
            <button type="button" onClick={onClose} className="mt-5 bg-gray-900 text-white px-6 py-2 rounded-xl text-sm font-medium">Cerrar</button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900"><i aria-hidden="true" className="fas fa-flag text-red-500 mr-2"></i>Reportar</h3>
                <p className="text-sm text-gray-500 mt-1">{targetLabel}</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
                <i aria-hidden="true" className="fas fa-times"></i>
              </button>
            </div>
            <div className="space-y-3">
              <select aria-label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 text-sm">
                {REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
              <textarea
                aria-label="Descripción del reporte"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Cuéntanos qué ocurre..."
                className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 h-24 resize-none text-sm"
              />
              {!user && (
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tu email de contacto" className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 text-sm" />
              )}
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
              <button type="button" onClick={send} className="w-full bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-700">
                Enviar reporte
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportDialog;
