import React, { useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { platformChanged } from '../lib/platform';
import { checkProfileImage, prepareProfileImage, type ProfileImageKind } from '../lib/profileImage';

interface Props {
  kind: ProfileImageKind;
  onDone: (message: string, ok: boolean) => void;
  className?: string;
}

// Camera button that changes the profile photo or the cover photo, like Facebook's.
const ProfileImageButton: React.FC<Props> = ({ kind, onDone, className = '' }) => {
  const { user, refreshUser } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const label = kind === 'avatar' ? 'Cambiar foto de perfil' : 'Cambiar foto de portada';

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    const problem = checkProfileImage(file);
    if (problem) return onDone(problem, false);
    setBusy(true);
    try {
      const image = await prepareProfileImage(file, kind);
      const result = await backend.setProfileImage(user, kind, image);
      if (!result.ok) return onDone(result.error || 'No se pudo guardar la foto', false);
      await refreshUser();
      platformChanged();
      onDone(kind === 'avatar' ? 'Foto de perfil actualizada' : 'Portada actualizada', true);
    } catch (err) {
      onDone(err instanceof Error ? err.message : 'No se pudo guardar la foto', false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={input} type="file" accept="image/*" onChange={pick} className="hidden" data-testid={`${kind}-input`} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={label}
        title={label}
        data-testid={`${kind}-button`}
        className={`flex items-center justify-center gap-2 bg-white/95 text-ink shadow-md hover:bg-white transition disabled:opacity-70 ${className}`}
      >
        {busy ? (
          <i aria-hidden="true" className="fas fa-spinner fa-spin"></i>
        ) : (
          <i aria-hidden="true" className="fas fa-camera"></i>
        )}
        {kind === 'cover' && <span className="hidden sm:inline text-sm font-semibold">{busy ? 'Subiendo…' : 'Editar portada'}</span>}
      </button>
    </>
  );
};

export default ProfileImageButton;
