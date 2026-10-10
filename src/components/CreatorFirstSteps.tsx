import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../lib/backend/types';
import { backend } from '../lib/backend';
import { usePlatformQuery, platformApi } from '../lib/platform';
import { socialApi } from '../lib/social';
import { readJSON, writeJSON } from '../lib/storage';
import { profileLink } from '../lib/creatorLinks';
import { isPlaceholderImage } from './CoverArt';
import { hasOwnAvatar } from '../lib/backend/shared';

interface Props {
  user: User;
  onOpenTab: (tab: string) => void;
  onNewPost: () => void;
}

type Step = { id: string; title: string; hint: string; done: boolean } & ({ to: string } | { action: () => void; label: string });

const hiddenKey = (userId: string) => `first_steps_hidden_${userId}`;
const sharedKey = (userId: string) => `first_steps_shared_${userId}`;

// Panel: the creator's first steps, each with a button that takes them there. Ticks
// itself as they go; disappears when everything is done or they hide it.
const CreatorFirstSteps: React.FC<Props> = ({ user, onOpenTab, onNewPost }) => {
  const profileId = user.creatorProfileId ?? user.id;
  const [hidden, setHidden] = useState(() => readJSON<boolean>(hiddenKey(user.id), false));
  const [shared, setShared] = useState(() => readJSON<boolean>(sharedKey(user.id), false));
  const { data } = usePlatformQuery(
    async () => {
      const [posts, experiences, payout] = await Promise.all([
        socialApi.postsByCreator(profileId),
        backend.listExperiences(),
        platformApi.payoutAccount(user.id),
      ]);
      return {
        posts: posts.length,
        experiences: experiences.filter((e) => e.creatorProfileId === profileId && e.active).length,
        payout: !!payout,
      };
    },
    [profileId, user.id],
    null
  );

  if (hidden || !data) return null;

  const share = () => {
    if (!user.username) return;
    navigator.clipboard?.writeText(profileLink(user.username)).catch(() => undefined);
    writeJSON(sharedKey(user.id), true);
    setShared(true);
  };

  const steps: Step[] = [
    {
      id: 'photo',
      title: 'Foto de perfil y portada',
      hint: 'Toca tu foto o tu portada en tu perfil para cambiarlas.',
      done: hasOwnAvatar(user.avatar) && !isPlaceholderImage(user.avatar) && !isPlaceholderImage(user.cover),
      to: `/creator/${profileId}`,
    },
    {
      id: 'bio',
      title: 'Bio y categoría',
      hint: 'Cuenta en una línea qué haces y elige tu categoría.',
      done: !!user.bio?.trim() && !!user.settings.category,
      action: () => onOpenTab('settings'),
      label: 'Completar',
    },
    {
      id: 'socials',
      title: 'Tu @usuario y tus redes',
      hint: 'Enlaza tu TikTok, Instagram o YouTube para que tus seguidores te reconozcan.',
      done: Object.keys(user.settings.socials ?? {}).length > 0,
      to: '/settings?section=profile&focus=redes',
    },
    {
      id: 'verify',
      title: 'Verifica tu identidad',
      hint: 'Sin verificar no puedes cobrar y tus publicaciones quedan como borrador.',
      done: !!user.isVerified,
      to: '/settings?section=verification',
    },
    {
      id: 'post',
      title: 'Sube tu primera publicación',
      hint: 'Una foto o un video para que tu perfil no se vea vacío.',
      done: data.posts > 0,
      action: onNewPost,
      label: 'Subir',
    },
    {
      id: 'reserve',
      title: 'Crea tu primera experiencia Reserve',
      hint: 'Una videollamada 1:1 o un evento en grupo que tus fans puedan reservar.',
      done: data.experiences > 0,
      action: () => onOpenTab('vip'),
      label: 'Crear',
    },
    {
      id: 'payout',
      title: 'Añade tu PayPal para retiros',
      hint: 'Ahí te llega lo que ganas.',
      done: data.payout,
      action: () => onOpenTab('earnings'),
      label: 'Añadir',
    },
    {
      id: 'share',
      title: 'Comparte tu enlace',
      hint: user.username ? `Pon fansreserve.com/@${user.username} en la bio de tus redes sociales.` : 'Pon tu enlace en la bio de tus redes sociales.',
      done: shared,
      action: share,
      label: 'Copiar enlace',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  const hide = () => {
    writeJSON(hiddenKey(user.id), true);
    setHidden(true);
  };

  return (
    <section className="bg-white rounded-2xl border border-line p-5 mb-8" data-testid="first-steps" aria-labelledby="first-steps-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-steps-title" className="font-display text-lg font-bold text-ink">Primeros pasos</h2>
          <p className="text-sm text-ink/60">
            {done} de {steps.length} listos. Completa tu perfil para empezar a ganar.
          </p>
        </div>
        <button type="button" onClick={hide} className="text-sm text-ink/50 hover:text-ink/80 whitespace-nowrap">
          Ocultar
        </button>
      </div>
      <div className="mt-3 h-2 rounded-full bg-ink/5 overflow-hidden" aria-hidden="true">
        <div className="h-full bg-brand-500 rounded-full transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 divide-y divide-line">
        {steps.map((s) => (
          <li key={s.id} className="py-3 flex items-center gap-3" data-testid={`first-step-${s.id}`} data-done={s.done}>
            <span
              className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs ${s.done ? 'bg-green-500 text-white' : 'border-2 border-ink/15 text-transparent'}`}
              aria-label={s.done ? 'Listo' : 'Pendiente'}
            >
              <i aria-hidden="true" className="fas fa-check"></i>
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${s.done ? 'text-ink/45 line-through' : 'text-ink'}`}>{s.title}</p>
              {!s.done && <p className="text-xs text-ink/55">{s.hint}</p>}
            </div>
            {!s.done &&
              ('to' in s ? (
                <Link to={s.to} className="btn btn-sm btn-outline whitespace-nowrap">Ir</Link>
              ) : (
                <button type="button" onClick={s.action} className="btn btn-sm btn-outline whitespace-nowrap">{s.label}</button>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
};

export default CreatorFirstSteps;
