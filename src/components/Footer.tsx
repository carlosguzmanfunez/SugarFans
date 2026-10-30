import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { BRAND } from '../config/brand';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../lib/backend/types';
import { BECOME_CREATOR_LINK, canBecomeCreator } from '../lib/becomeCreator';

// Signup links only make sense to visitors; members get their own shortcut.
const accountLinks = (role: UserRole | undefined, canSwitch = false) => {
  if (!role) return { platform: { label: 'Crear cuenta', to: '/register' }, creators: { label: 'Empezar como creador', to: '/register?role=creator' } };
  if (role === 'creator') return { platform: { label: 'Mi cuenta', to: '/profile' }, creators: { label: 'Mi panel de creador', to: '/creator/dashboard' } };
  if (role === 'admin') return { platform: { label: 'Mi cuenta', to: '/profile' }, creators: { label: 'Panel de administración', to: '/admin' } };
  return { platform: { label: 'Mi cuenta', to: '/profile' }, creators: canSwitch ? { label: 'Hazte creador', to: BECOME_CREATOR_LINK } : null };
};

const columnsFor = (role: UserRole | undefined, canSwitch = false): { title: string; links: { label: string; to: string }[] }[] => {
  const account = accountLinks(role, canSwitch);
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
    <div className="mx-auto max-w-7xl px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14 md:pt-16 lg:px-8">
      <div className="grid gap-8 sm:gap-12 lg:grid-cols-[1.3fr_2fr]">
        <div className="max-w-sm">
          <BrandLogo size="sm" tone="dark" />
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Membresías, contenido exclusivo y Reserve: videollamadas 1:1 y eventos definidos por cada creador.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs">
            {[
              { icon: 'fa-id-card', label: 'Creadores verificados' },
              { icon: 'fa-lock', label: 'Pago seguro' },
              { icon: 'fa-user-shield', label: 'Solo mayores de 18' },
            ].map((b) => (
              <li key={b.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white/70">
                <i className={`fas ${b.icon} text-gold-300`} aria-hidden="true"></i> {b.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 sm:gap-8">
          {columnsFor(user?.role, canBecomeCreator(user)).map((col) => (
            <div key={col.title}>
              <h3 className="font-display text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-3 space-y-2.5 text-sm sm:mt-4 sm:space-y-3">
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

      <div className="mt-10 flex flex-col gap-3 border-t sm:mt-14 border-white/10 pt-6 text-xs text-white/45 md:flex-row md:items-center md:justify-between">
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
