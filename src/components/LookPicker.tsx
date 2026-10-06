import React, { useEffect } from 'react';
import { LOOKS } from '../lib/videoLooks';
import type { CameraLook } from '../hooks/useCameraLook';
import { useAuth } from '../context/AuthContext';
import { useLevels } from '../lib/rewards';

// Advanced looks a creator unlocks at Oro. Fans use every look.
const ORO_LOOKS = new Set(['studio', 'blur']);

// Camera look chooser for the dark call screens: five looks plus "Mejorar apariencia".
const LookPicker: React.FC<{ cam: CameraLook; className?: string }> = ({ cam, className = '' }) => {
  const { user } = useAuth();
  const creatorId = user?.role === 'creator' ? user.creatorProfileId ?? user.id : '';
  const levels = useLevels(creatorId ? [creatorId] : []);
  const level = creatorId ? levels[creatorId] ?? 'bronce' : null;
  const lockedOut = level === 'bronce' || level === 'plata';
  const locked = (id: string) => lockedOut && ORO_LOOKS.has(id);
  useEffect(() => {
    if (locked(cam.look)) cam.setLook('natural');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedOut, cam.look]);
  if (!cam.supported) {
    return (
      <p className={`text-xs text-gray-400 ${className}`} data-testid="looks-unsupported">
        Este navegador no permite filtros de cámara. Tu video sale en Natural.
      </p>
    );
  }
  return (
    <div className={className} data-testid="look-picker">
      <div role="radiogroup" aria-label="Filtro de cámara" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x sm:flex-wrap sm:overflow-visible">
        {LOOKS.map((l) => {
          const on = cam.look === l.id;
          const off = locked(l.id);
          return (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={off}
              title={off ? 'Se desbloquea en el nivel Oro' : undefined}
              data-locked={off ? 'true' : undefined}
              onClick={() => cam.setLook(l.id)}
              className={`snap-start shrink-0 sm:shrink sm:flex-1 min-w-[6.5rem] text-left px-3 py-2 rounded-xl border transition-colors ${
                on ? 'bg-pink-600 border-pink-500 text-white' : off ? 'bg-white/5 border-white/10 text-gray-500 cursor-not-allowed' : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'
              }`}
            >
              <span className="block text-sm font-semibold whitespace-nowrap">
                <i aria-hidden="true" className={`fas ${l.icon} mr-1.5 text-xs opacity-80`}></i>
                {l.name}
              </span>
              <span className={`block text-[11px] whitespace-nowrap ${on ? 'text-pink-100' : 'text-gray-400'}`}>{off ? '🔒 Desde Oro' : l.hint}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-pressed={cam.enhance}
        onClick={cam.toggleEnhance}
        data-testid="enhance-toggle"
        className={`mt-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
          cam.enhance ? 'bg-gradient-to-r from-pink-500 to-purple-600 border-transparent text-white' : 'bg-white/5 border-white/15 text-gray-100 hover:bg-white/10'
        }`}
      >
        <i aria-hidden="true" className="fas fa-wand-magic-sparkles mr-2"></i>
        Mejorar apariencia{cam.enhance ? ' · activado' : ''}
      </button>
      {cam.notice && (
        <p role="status" className="mt-2 text-xs text-yellow-300">
          {cam.notice}
        </p>
      )}
    </div>
  );
};

export default LookPicker;
