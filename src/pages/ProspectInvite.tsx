import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { siteOpenHere } from '../components/LaunchGate';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import type { InviteInfo } from '../lib/backend/prospectTypes';
import { INVITE_CODE, countryLabel } from '../lib/prospects';
import { clearInviteCode, saveInviteCode } from '../lib/prospectInvite';

const PERKS = [
  { icon: 'fa-video', title: 'Videollamadas 1:1, Meet & Greet y eventos', text: 'Tus seguidores reservan un momento contigo. Tú pones el precio y los horarios.' },
  { icon: 'fa-shield-halved', title: 'Pago seguro', text: 'Tus fans pagan al reservar y tú cobras por PayPal.' },
  { icon: 'fa-star', title: 'Creadores Fundadores', text: 'Si alcanzas las metas del lanzamiento en tus primeros 90 días: mejores ganancias, una insignia en tu perfil y prioridad en Explorar.' },
];

type View = 'loading' | 'missing' | 'invite' | 'confirmLeave' | 'left' | 'joined';

// /c/<code>: the personal invite link we send each creator in "Captar creadores".
// Public, also while the pre-launch gate is up. Opening it is recorded (not for the
// team), "Quiero participar" saves their interest before the launch, the account
// they create afterwards is linked to the invite, and ?baja=1 lets them opt out.
const ProspectInvite: React.FC = () => {
  const { code: raw = '' } = useParams();
  const code = raw.trim().toLowerCase();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const wantsOut = new URLSearchParams(search).has('baja');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [view, setView] = useState<View>('loading');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const asked = useRef(false);
  const open = siteOpenHere();
  const team = user?.role === 'admin';

  // Invite pages are personal: keep them out of search engines.
  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', 'noindex, nofollow');
    return () => { if (previous) meta?.setAttribute('content', previous); };
  }, []);

  useEffect(() => {
    if (authLoading || asked.current) return;
    asked.current = true;
    if (!INVITE_CODE.test(code)) { setView('missing'); return; }
    backend.prospects.invite(code).then((r) => {
      setInfo(r);
      if (!r) { setView('missing'); return; }
      if (r.unsubscribed) { clearInviteCode(); setView('left'); return; }
      saveInviteCode(code);
      setView(wantsOut ? 'confirmLeave' : r.interested ? 'joined' : 'invite');
    }, () => setView('missing'));
  }, [authLoading, code, wantsOut]);

  const join = async () => {
    setBusy(true); setError('');
    const r = await backend.prospects.interest(code, email);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar. Intenta de nuevo.'); return; }
    setView('joined');
  };
  const leave = async () => {
    setBusy(true); setError('');
    const r = await backend.prospects.unsubscribe(code);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar. Intenta de nuevo.'); return; }
    clearInviteCode();
    setView('left');
  };

  const name = info?.name?.trim().split(/\s+/)[0];
  const hello = name && name.length > 1 && !/^[@\d]/.test(name) ? name : info ? `@${info.handle}` : '';
  const where = info?.country ? ` en ${countryLabel(info.country)}` : '';

  const shell = (children: React.ReactNode) => (
    <main className="relative min-h-screen overflow-hidden bg-night-950 px-5 py-10 text-white" data-testid="prospect-invite">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-48 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(200,27,99,0.32),transparent)]" />
        <div className="absolute -bottom-56 -right-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(109,60,230,0.28),transparent)]" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-center">
        <BrandLogo size="md" tone="dark" to={null} />
        {team && view !== 'loading' && <p className="mt-6 w-full rounded-xl border border-gold-300/40 bg-gold-300/10 px-4 py-2 text-center text-sm text-gold-100" data-testid="invite-team-preview">
          Vista previa del equipo: abrirla con tu cuenta no cuenta como abierta.</p>}
        {children}
      </div>
    </main>
  );

  if (view === 'loading') return shell(<div className="mt-24 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-gold-300" role="status" aria-label="Cargando" />);

  if (view === 'missing') return shell(<section className="mt-16 text-center">
    <h1 className="text-2xl font-bold">Esta invitación no existe o ya no está activa</h1>
    <p className="mt-3 text-white/70">Revisa que el link esté completo. Si crees que es un error, escríbenos a <a className="underline underline-offset-4" href="mailto:support@fansreserve.com">support@fansreserve.com</a>.</p>
  </section>);

  if (view === 'left') return shell(<section className="mt-16 text-center" role="status">
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/10"><i aria-hidden="true" className="fas fa-check text-xl text-gold-200" /></div>
    <h1 className="mt-5 text-2xl font-bold">Listo, no te volveremos a escribir</h1>
    <p className="mt-3 text-white/70">Borramos tus datos de contacto de nuestra lista. Si algún día cambias de opinión, escríbenos a <a className="underline underline-offset-4" href="mailto:support@fansreserve.com">support@fansreserve.com</a>.</p>
  </section>);

  if (view === 'confirmLeave') return shell(<section className="mt-16 w-full text-center">
    <h1 className="text-2xl font-bold">¿No quieres recibir más mensajes de Fans Reserve?</h1>
    <p className="mt-3 text-white/70">No te volveremos a escribir a {info ? `@${info.handle}` : 'esta cuenta'} y borramos tus datos de contacto.</p>
    {error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <button type="button" className="btn btn-lg btn-light" disabled={busy} onClick={() => void leave()} data-testid="invite-leave-confirm">{busy ? 'Guardando…' : 'Sí, no me escriban más'}</button>
      <button type="button" className="btn btn-lg btn-glass" disabled={busy} onClick={() => { setView('invite'); navigate(`/c/${code}`, { replace: true }); }}>Ver la invitación</button>
    </div>
  </section>);

  return shell(<>
    <section className="mt-12 w-full text-center">
      <p className="text-lg text-gold-200">Hola, {hello} 👋</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl" style={{ textWrap: 'balance' }}>Te invitamos al lanzamiento de Fans Reserve{where}</h1>
      <p className="mt-4 text-white/75">La plataforma donde tus seguidores reservan experiencias contigo.</p>
    </section>

    <ul className="mt-8 grid w-full gap-3">
      {PERKS.map((p) => <li key={p.title} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold-300/15 text-gold-200"><i aria-hidden="true" className={`fas ${p.icon}`} /></span>
        <span><span className="block font-semibold">{p.title}</span><span className="mt-0.5 block text-sm text-white/70">{p.text}</span></span>
      </li>)}
    </ul>

    <section className="mt-8 w-full rounded-2xl bg-white p-5 text-night-950 sm:p-6" aria-labelledby="invite-cta">
      {info?.registered ? <div className="text-center" role="status">
        <h2 id="invite-cta" className="text-xl font-bold">¡Ya tienes tu cuenta! 🎉</h2>
        <p className="mt-2 text-gray-600">Completa tu perfil y verifica tu identidad para empezar a recibir reservas.</p>
        {open && <Link to="/creator/dashboard" className="btn btn-lg btn-gold mt-5 w-full">Ir a mi panel</Link>}
      </div> : view === 'joined' ? <div className="text-center" role="status" data-testid="invite-joined">
        <h2 id="invite-cta" className="text-xl font-bold">¡Listo! Tu lugar está apartado 🎉</h2>
        <p className="mt-2 text-gray-600">{open ? 'Crea tu cuenta de creador para empezar. Tu invitación se conecta sola.' : `Te avisaremos apenas abramos${where}. Si nos escribiste por Instagram o correo, te contestamos por ahí mismo.`}</p>
        {open && <Link to="/register?role=creator" className="btn btn-lg btn-gold mt-5 w-full">Crear mi cuenta de creador</Link>}
      </div> : open ? <div>
        <h2 id="invite-cta" className="text-xl font-bold">Crea tu cuenta de creador</h2>
        <p className="mt-1 text-gray-600">Toma un par de minutos. Tu invitación se conecta sola.</p>
        <div className="mt-5 grid gap-3">
          <Link to="/register?role=creator" className="btn btn-lg btn-gold w-full" data-testid="invite-register">Crear mi cuenta de creador</Link>
          <Link to="/login" state={{ from: '/creator/dashboard' }} className="btn btn-lg btn-outline w-full">Ya tengo cuenta: iniciar sesión</Link>
        </div>
      </div> : <form onSubmit={(e) => { e.preventDefault(); void join(); }}>
        <h2 id="invite-cta" className="text-xl font-bold">Aparta tu lugar en el lanzamiento</h2>
        <p className="mt-1 text-gray-600">Estamos por abrir. Déjanos saber que te interesa y te avisamos primero.</p>
        <label htmlFor="invite-email" className="mt-5 block text-sm font-medium text-gray-800">Tu correo <span className="font-normal text-gray-500">(opcional, para avisarte)</span></label>
        <input id="invite-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160}
          className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-base" placeholder="tucorreo@ejemplo.com" />
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <button type="submit" className="btn btn-lg btn-gold mt-4 w-full" disabled={busy} data-testid="invite-join">{busy ? 'Guardando…' : 'Quiero participar'}</button>
        <p className="mt-3 text-xs text-gray-500">Solo usamos tu correo para avisarte del lanzamiento. <Link to="/legal" className="underline underline-offset-2">Privacidad</Link></p>
      </form>}
    </section>

    <p className="mt-8 text-center text-sm text-white/60">
      ¿No te interesa? <button type="button" className="underline underline-offset-4 hover:text-white" onClick={() => setView('confirmLeave')} data-testid="invite-leave">No quiero recibir más mensajes</button>
    </p>
  </>);
};

export default ProspectInvite;
