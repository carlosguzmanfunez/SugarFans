import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { BRAND } from '../config/brand';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../lib/backend/types';

// Signup links only make sense to visitors; members get their own shortcut.
const accountLinks = (role: UserRole | undefined) => {
  if (!role) return { platform: { label: 'Crear cuenta', to: '/register' }, creators: { label: 'Empezar como creador', to: '/register?role=creator' } };
  if (role === 'creator') return { platform: { label: 'Mi perfil', to: '/profile' }, creators: { label: 'Mi panel de creador', to: '/creator/dashboard' } };
  if (role === 'admin') return { platform: { label: 'Mi perfil', to: '/profile' }, creators: { label: 'Panel de administración', to: '/admin' } };
  return { platform: { label: 'Mi perfil', to: '/profile' }, creators: null };
};

const columnsFor = (role: UserRole | undefined): { title: string; links: { label: string; to: string }[] }[] => {
  const account = accountLinks(role);
  return [
  {
    title: 'Plataforma',
    links: [
      { label: 'Explorar creadores', to: '/explore' },
      { label: 'Reserve', to: '/reserve' },
      account.platform,
      { label: 'Centro de ayuda', to: '/help' },
    ],
  },
  {
    title: 'Creadores',
    links: [
      ...(account.creators ? [account.creators] : []),
      { label: 'Contrato de creadores', to: '/legal?doc=creator' },
      { label: 'Verificación de identidad', to: '/help' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Centro legal', to: '/legal' },
      { label: 'Términos de servicio', to: '/legal?doc=terms' },
      { label: 'Privacidad', to: '/legal?doc=privacy' },
      { label: 'Cookies', to: '/legal?doc=cookies' },
    ],
  },
  {
    title: 'Seguridad',
    links: [
      { label: 'Protección de menores', to: '/legal?doc=minors' },
      { label: 'Reportar contenido', to: '/help' },
      { label: 'Derechos de autor (DMCA)', to: '/legal?doc=dmca' },
    ],
  },
  ];
};

const Footer: React.FC = () => {
  const { user } = useAuth();
  return (
  <footer className="relative overflow-hidden bg-night-950 text-white/70">
    <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/50 to-transparent" />
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-14 sm:px-6 md:pt-16 lg:px-8">
      <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
        <div className="max-w-sm">
          <BrandLogo size="sm" tone="dark" />
          <p className="mt-5 text-[15px] leading-relaxed text-white/60">
            Membresías, contenido exclusivo, sesiones en vivo y Reserve: experiencias definidas por cada creador.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2 text-xs">
            {[
              { icon: 'fa-id-card', label: 'Creadores verificados' },
              { icon: 'fa-lock', label: 'Pagos protegidos' },
              { icon: 'fa-user-shield', label: '+18' },
            ].map((b) => (
              <li key={b.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white/70">
                <i className={`fas ${b.icon} text-gold-300`} aria-hidden="true"></i> {b.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {columnsFor(user?.role).map((col) => (
            <div key={col.title}>
              <h3 className="font-display text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-3 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} className="text-white/60 transition-colors hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/45 md:flex-row md:items-center md:justify-between">
        <p>
          © {new Date().getFullYear()} {BRAND.name}. Todos los derechos reservados. Solo para mayores de 18 años.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span>{BRAND.domain}</span>
          <a href={`mailto:${BRAND.emails.support}`} className="hover:text-white">{BRAND.emails.support}</a>
        </p>
      </div>
    </div>
  </footer>
  );
};

export default Footer;
