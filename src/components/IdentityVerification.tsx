import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, platformApi, submitVerification, readImageFile, docTypeLabel, type DocType } from '../lib/platform';
import { useSearchParams } from 'react-router-dom';
import { diditEnabled, startDidit } from '../lib/didit';
import DiditReturn, { returnedFromDidit } from './DiditReturn';

const field = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';

const PhotoInput: React.FC<{
  name: string;
  label: string;
  hint: string;
  icon: string;
  capture?: 'user' | 'environment';
  value: string;
  onChange: (v: string) => void;
  onError: (e: string) => void;
}> = ({ name, label, hint, icon, capture, value, onChange, onError }) => (
  <label className="block border-2 border-dashed border-gray-200 rounded-xl p-3 text-center cursor-pointer hover:border-pink-300 transition">
    {value ? (
      <img src={value} alt={label} className="h-28 w-full object-contain rounded-lg" />
    ) : (
      <div className="h-28 flex flex-col items-center justify-center text-gray-400">
        <i aria-hidden="true" className={`fas ${icon} text-2xl mb-2`}></i>
        <span className="text-xs">{hint}</span>
      </div>
    )}
    <span className="block text-sm font-medium text-gray-700 mt-2">{label}</span>
    <input
      type="file"
      name={name}
      accept="image/*"
      // On phones this opens the front (selfie) or back camera directly.
      capture={capture}
      className="sr-only"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          onChange(await readImageFile(file));
          onError('');
        } catch (err) {
          onError((err as Error).message);
        }
      }}
    />
  </label>
);

// Settings > Verificación: upload an ID document + selfie, then follow the review status.
const IdentityVerification: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // Back from Didit: wait for its decision, then celebrate or show the status.
  const [returning, setReturning] = useState(() => returnedFromDidit(searchParams));
  const { data: request, loading, reload } = usePlatformQuery(
    () => (user ? platformApi.myVerification(user.id) : Promise.resolve(null)),
    [user?.id, user?.isVerified],
    null
  );
  const [legalName, setLegalName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [country, setCountry] = useState('');
  const [docType, setDocType] = useState<DocType>('dni');
  const [docNumber, setDocNumber] = useState('');
  const [docFront, setDocFront] = useState('');
  const [selfie, setSelfie] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const [sending, setSending] = useState(false);
  // With Didit set up, Didit checks the document, liveness and face match instead of the manual form.
  const [didit, setDidit] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    diditEnabled().then((on) => alive && setDidit(on));
    return () => {
      alive = false;
    };
  }, []);

  if (returning) return <DiditReturn onDone={() => { setReturning(false); reload(); }} />;
  if (!user || loading || didit === null) return null;
  const verified = !!user.isVerified || request?.status === 'approved';

  const submit = async () => {
    setSending(true);
    const result = await submitVerification(user, { legalName, birthDate, country, docType, docNumber, docFront, selfie });
    setSending(false);
    if (!result.ok) return setError(result.error || 'No se pudo enviar la solicitud');
    setError('');
    setRetry(false);
    setDocFront('');
    setSelfie('');
  };

  const openDidit = async () => {
    setSending(true);
    try {
      await startDidit();
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  };

  const header = (
    <>
      <h2 className="text-lg font-bold text-gray-900 mb-2">Verificación de identidad</h2>
      <p className="text-sm text-gray-600 mb-6">
        {didit
          ? 'Toma unos 2 minutos con tu documento oficial y la cámara de tu celular o computadora. Comprobamos que el documento es real, que eres mayor de edad y que eres tú. '
          : 'Solo necesitamos dos fotos: el frente de tu documento oficial y un selfie de frente. Comprobamos que eres mayor de edad y que la cara del selfie coincide con la del documento. '}
        Es obligatoria para que los creadores publiquen y cobren, y añade la insignia <span className="text-blue-700 font-medium">Verificado</span> a tu perfil.
      </p>
    </>
  );

  if (verified) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="verification">
        {header}
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <i aria-hidden="true" className="fas fa-check-circle text-2xl text-blue-600"></i>
          <div>
            <p className="font-medium text-blue-900">Identidad verificada</p>
            <p className="text-xs text-blue-700">
              {request?.reviewedAt ? `Aprobada el ${new Date(request.reviewedAt).toLocaleDateString('es')}. ` : ''}
              {request?.provider === 'didit' ? 'Verificada con Didit.' : 'Tus documentos se eliminaron tras la revisión.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (request?.status === 'pending') {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="verification">
        {header}
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <i aria-hidden="true" className="fas fa-hourglass-half text-2xl text-yellow-600"></i>
          <div>
            <p className="font-medium text-yellow-900">Solicitud en revisión</p>
            <p className="text-xs text-yellow-700">
              {request.provider === 'didit'
                ? 'Didit necesita que nuestro equipo revise tu verificación. Te avisaremos aquí cuando esté lista.'
                : `Enviada el ${new Date(request.submittedAt).toLocaleString('es')} · ${docTypeLabel[request.docType]}. Te avisaremos aquí cuando se revise.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (request?.status === 'rejected' && !retry) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="verification">
        {header}
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="font-medium text-red-800"><i aria-hidden="true" className="fas fa-times-circle mr-2"></i>Solicitud rechazada</p>
          <p className="text-sm text-red-700 mt-1">Motivo: {request.rejectionReason}</p>
          <button type="button" onClick={() => setRetry(true)} className="mt-3 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
            Enviar de nuevo
          </button>
        </div>
      </div>
    );
  }

  if (didit) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="verification">
        {header}
        <ul className="text-sm text-gray-700 space-y-2 mb-5">
          <li><i aria-hidden="true" className="fas fa-id-card w-5 text-pink-500"></i> Ten a mano tu documento original (no una copia).</li>
          <li><i aria-hidden="true" className="fas fa-camera w-5 text-pink-500"></i> Busca buena luz y quítate gorra o gafas de sol.</li>
          <li><i aria-hidden="true" className="fas fa-shield-alt w-5 text-pink-500"></i> Lo hace Didit, nuestro proveedor de verificación. Al terminar vuelves aquí.</li>
          <li data-testid="verify-qr-hint"><i aria-hidden="true" className="fas fa-mobile-alt w-5 text-pink-500"></i> ¿Tu computadora no tiene cámara? Didit te muestra un código QR para terminar desde tu celular.</li>
        </ul>
        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}
        <button type="button" onClick={openDidit} disabled={sending} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-60">
          {sending ? 'Abriendo…' : 'Verificar mi identidad'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="verification">
      {header}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={field} name="legalName" placeholder="Nombre completo (como en el documento)" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          <div>
            <input className={field} type="date" name="birthDate" aria-label="Fecha de nacimiento" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <input className={field} name="country" placeholder="País que emitió el documento" value={country} onChange={(e) => setCountry(e.target.value)} />
          <select className={field} name="docType" aria-label="Tipo de documento" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {(Object.keys(docTypeLabel) as DocType[]).map((k) => (
              <option key={k} value={k}>{docTypeLabel[k]}</option>
            ))}
          </select>
          <input className={`${field} sm:col-span-2`} name="docNumber" placeholder="Número de documento" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PhotoInput
            name="docFront"
            label={docType === 'passport' ? 'Página de datos del pasaporte' : 'Frente del documento'}
            hint="Con tu foto y fecha de nacimiento visibles"
            icon="fa-id-card"
            capture="environment"
            value={docFront}
            onChange={setDocFront}
            onError={setError}
          />
          <PhotoInput
            name="selfie"
            label="Selfie de frente"
            hint="Cara descubierta, buena luz, sin gafas de sol"
            icon="fa-camera"
            capture="user"
            value={selfie}
            onChange={setSelfie}
            onError={setError}
          />
        </div>
        <p className="text-xs text-gray-500">
          <i aria-hidden="true" className="fas fa-shield-alt mr-1"></i>Solo el equipo de verificación ve estas imágenes y se eliminan en cuanto se aprueba la solicitud.
        </p>
        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <button type="button" onClick={submit} disabled={sending} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition">
          Enviar para verificación
        </button>
      </div>
    </div>
  );
};

export default IdentityVerification;
