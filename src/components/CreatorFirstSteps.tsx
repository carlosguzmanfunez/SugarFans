import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import type { User } from '../lib/backend/types';
import { backend } from '../lib/backend';
import { usePlatformQuery, platformApi } from '../lib/platform';
import { socialApi } from '../lib/social';
import { readJSON, writeJSON } from '../lib/storage';
import { profileLink } from '../lib/creatorLinks';
import { isPlaceholderImage } from './CoverArt';
import { hasOwnAvatar } from '../lib/backend/shared';
import { firstStepsDone, markFirstStepsDone, setupPath } from '../lib/creatorSetup';

interface Props {
  user: User;
}

type Step = { id: string; title: string; hint: string; done: boolean; label?: string } & ({ to: string } | { action: () => void });

const hiddenKey = (userId: string) => `first_steps_hidden_${userId}`;
const sharedKey = (userId: string) => `first_steps_shared_${userId}`;

// Panel: the creator's first steps, each with a button that takes them there. Ticks
// itself as they go; collapses to a text disclosure until everything is done.
const CreatorFirstSteps: React.FC<Props> = ({ user }) => {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  // Just finished: a moment to celebrate, then on to Inicio (from now on they start there).
  const [finished, setFinished] = useState(false);
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

  useEffect(() => {
    if (hash === '#primeros-pasos' && data && !hidden) document.getElementById('primeros-pasos')?.scrollIntoView({ block: 'start' });
  }, [hash, data, hidden]);

  // Every step but sharing the link (that one is only remembered on this device).
  const ready = !!data && !!user.isVerified && hasOwnAvatar(user.avatar) && !isPlaceholderImage(user.avatar) && !isPlaceholderImage(user.cover)
    && !!user.bio?.trim() && !!user.settings.category && Object.keys(user.settings.socials ?? {}).length > 0
    && data.posts > 0 && data.experiences > 0 && data.payout;
  const alreadyDone = firstStepsDone(user.id);
  useEffect(() => {
    if (!ready || alreadyDone || user.isOwner) return;
    markFirstStepsDone(user.id);
    setFinished(true);
    const timer = setTimeout(() => navigate('/'), 3500);
    return () => clearTimeout(timer);
  }, [ready, alreadyDone, user.id, user.isOwner, navigate]);

  if (finished)
    return (
      <div role="status" data-testid="first-steps-finished" className="mb-8 rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-xl text-white"><i aria-hidden="true" className="fas fa-check"></i></span>
        <p className="mt-3 font-display text-lg font-bold text-ink">{t('firstSteps.finished.title')}</p>
        <p className="mt-1 text-sm text-ink/70">{t('firstSteps.finished.body')}</p>
        <Link to="/" className="btn btn-sm btn-primary mt-3">{t('firstSteps.finished.button')}</Link>
      </div>
    );
  if (!data) return null;

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
      to: setupPath(`/creator/${profileId}`, 'photo'),
    },
    {
      id: 'bio',
      title: 'Bio y categoría',
      hint: 'Cuenta en una línea qué haces y elige tu categoría.',
      done: !!user.bio?.trim() && !!user.settings.category,
      to: setupPath('/creator/dashboard?tab=settings', 'bio'),
      label: 'Completar',
    },
    {
      id: 'socials',
      title: 'Tu @usuario y tus redes',
      hint: 'Enlaza tu TikTok, Instagram o YouTube para que tus seguidores te reconozcan.',
      done: Object.keys(user.settings.socials ?? {}).length > 0,
      to: setupPath('/settings?section=profile&focus=redes', 'socials'),
    },
    {
      id: 'verify',
      title: 'Verifica tu identidad',
      hint: 'Sin verificar no puedes cobrar y tus publicaciones quedan como borrador.',
      done: !!user.isVerified,
      to: setupPath('/settings?section=verification', 'verify'),
    },
    {
      id: 'post',
      title: 'Sube tu primera publicación',
      hint: 'Una foto o un video para que tu perfil no se vea vacío.',
      done: data.posts > 0,
      to: setupPath('/creator/dashboard#nuevo', 'post'),
      label: 'Subir',
    },
    {
      id: 'reserve',
      title: 'Crea tu primera experiencia Reserve',
      hint: 'Una videollamada 1:1 o un evento en grupo que tus fans puedan reservar.',
      done: data.experiences > 0,
      to: setupPath('/creator/dashboard?tab=vip', 'reserve'),
      label: 'Crear',
    },
    {
      id: 'payout',
      title: 'Añade tu PayPal para retiros',
      hint: 'Ahí te llega lo que ganas.',
      done: data.payout,
      to: setupPath('/creator/dashboard?tab=earnings', 'payout'),
      label: 'Añadir',
    },
    {
      id: 'share',
      title: 'Comparte tu enlace',
      hint: 'Ponlo en la bio de tus redes sociales.',
      done: shared,
      action: share,
      label: 'Copiar enlace',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  return (
    <details
      id="primeros-pasos"
      open={!hidden}
      onToggle={(event) => {
        const collapsed = !event.currentTarget.open;
        writeJSON(hiddenKey(user.id), collapsed);
        setHidden(collapsed);
      }}
      className={`scroll-mt-28 mb-8 ${hidden ? '' : 'bg-white rounded-2xl border border-line p-5'}`}
      data-testid="first-steps"
      aria-labelledby="first-steps-title"
    >
      <summary className={`list-none cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden ${hidden ? 'inline-flex min-h-11 items-center gap-2' : 'flex items-start justify-between gap-3'}`}>
        <h2 id="first-steps-title" className={`font-display text-ink ${hidden ? 'text-sm font-semibold' : 'text-lg font-bold'}`}>Primeros pasos</h2>
        <span className="text-sm text-ink/70 hover:text-ink whitespace-nowrap">{hidden ? '· Expandir' : 'Ocultar'}</span>
      </summary>
      {!hidden && <>
      <p className="text-sm text-ink/60">
        {done} de {steps.length} listos. Completa tu perfil para empezar a ganar.
      </p>
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
                <Link to={s.to} className="btn btn-sm btn-outline whitespace-nowrap">{s.label || 'Ir'}</Link>
              ) : (
                <button type="button" onClick={s.action} className="btn btn-sm btn-outline whitespace-nowrap">{s.label}</button>
              ))}
          </li>
        ))}
      </ol>
      </>}
    </details>
  );
};

export default CreatorFirstSteps;
