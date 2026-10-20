import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, type UserRole } from '../context/AuthContext';
import Icon from '../components/Icon';

const views: { role: UserRole; title: string; description: string; to: string; icon: string }[] = [
  { role: 'fan', title: 'Fan', description: 'Explora, sigue creadores y revisa las experiencias como fan.', to: '/explore', icon: 'fa-heart' },
  { role: 'creator', title: 'Creador', description: 'Revisa tu contenido, experiencias, solicitudes e ingresos.', to: '/creator/dashboard', icon: 'fa-star' },
  { role: 'admin', title: 'Administrador', description: 'Gestiona usuarios, moderación, finanzas y configuración.', to: '/admin', icon: 'fa-shield-halved' },
];

const OwnerPanel: React.FC = () => {
  const { user, switchOwnerView } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<UserRole | null>(null);
  const [error, setError] = useState('');
  const enter = async (view: typeof views[number]) => {
    if (busy) return;
    setBusy(view.role); setError('');
    try {
      const result = await switchOwnerView(view.role);
      if (!result.ok) { setError(result.error ?? 'No se pudo cambiar de vista'); return; }
      navigate(view.to);
    } catch { setError('No se pudo confirmar el cambio. Inténtalo de nuevo.'); }
    finally { setBusy(null); }
  };
  if (!user?.isOwner) return <div className="mx-auto max-w-xl px-4 py-12"><h1 className="text-2xl font-bold">Dirección general</h1><p className="mt-3 text-muted">Esta sección está disponible para el propietario de Fans Reserve.</p><Link to="/" className="btn btn-outline btn-md mt-5">Volver al inicio</Link></div>;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12" aria-labelledby="owner-title">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Cuenta del propietario</p>
      <h1 id="owner-title" className="mt-2 text-3xl font-bold text-ink sm:text-4xl">Dirección general</h1>
      <p className="mt-3 max-w-2xl text-muted">Elige cómo quieres recorrer Fans Reserve. Tu cuenta conserva su perfil de creador, su historial y tus permisos de propietario al cambiar de vista.</p>
      <p className="mt-4 break-all text-sm font-medium text-ink">{user.email}</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-danger">{error}</p>}
      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {views.map((view) => (
          <article key={view.role} className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-sm">
            <Icon name={view.icon} className="size-7 text-brand-700" />
            <h2 className="mt-4 text-xl font-semibold text-ink">{view.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted">{view.description}</p>
            <p className="mt-4 min-h-5 text-xs font-semibold text-brand-700">{user.role === view.role ? 'Vista actual' : ''}</p>
            <button type="button" data-testid={'owner-view-'+view.role} disabled={busy !== null} onClick={() => enter(view)} className="btn btn-primary btn-md mt-3 w-full disabled:opacity-60">
              {busy === view.role ? 'Cambiando…' : 'Entrar como '+view.title}
            </button>
          </article>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">Puedes volver a este panel desde el menú de tu cuenta → Dirección general. Las acciones que realices en la página publicada se guardan en tu cuenta.</p>
    </section>
  );
};
export default OwnerPanel;
