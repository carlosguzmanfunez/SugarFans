import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { usePlatformQuery, money } from '../lib/platform';
import { rewardsApi } from '../lib/rewards';
import { isEventExperience, type VipExperience } from '../lib/vip';
import { GOAL_MAX, GOAL_MIN, TICKET_BONUSES, TICKET_DAYS, validateGoal } from '../lib/experienceGoalRules';

const DEFAULT_TARGET = 100;

// Creator panel > Recompensas: turns on the Meta de experiencia, sets how much a fan
// has to give in gifts and tips, and which of the creator's experiences can be won.
const ExperienceGoalSettings: React.FC = () => {
  const { user } = useAuth();
  const { data: experiences } = usePlatformQuery(
    async () => (await backend.listExperiences()).filter((e) => e.creatorProfileId === user?.creatorProfileId && e.active && !isEventExperience(e)),
    [user?.creatorProfileId],
    [] as VipExperience[]
  );
  const { data: saved, reload } = usePlatformQuery(() => (user ? rewardsApi.myGoalSettings(user) : Promise.resolve(null)), [user?.id], null);
  const [enabled, setEnabled] = useState(false);
  const [target, setTarget] = useState(String(DEFAULT_TARGET));
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!saved) return;
    setEnabled(saved.enabled);
    setTarget(String(saved.target));
    setIds(saved.experienceIds);
  }, [saved]);

  if (!user) return null;

  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = async () => {
    const input = { enabled, target: Number(target), experienceIds: ids.filter((id) => experiences.some((e) => e.id === id)) };
    const check = validateGoal(input);
    if (!check.ok) {
      setNotice('');
      return setError(check.error!);
    }
    setSaving(true);
    const result = await rewardsApi.saveGoal(user, input);
    setSaving(false);
    if (!result.ok) {
      setNotice('');
      return setError(result.error || 'No se pudo guardar tu meta');
    }
    setError('');
    setNotice(enabled ? 'Meta guardada: ya aparece en tu perfil.' : 'Meta guardada y apagada.');
    reload();
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="goal-settings">
      <h3 className="font-bold text-gray-900 mb-1"><i aria-hidden="true" className="fas fa-piggy-bank text-pink-500 mr-2"></i>Meta de experiencia</h3>
      <p className="text-sm text-gray-500 mb-4">
        Cada fan llena su propia meta con regalos y propinas. Al completarla elige una de las experiencias que marques aquí, gira una ruleta
        donde todo premio es un extra que tú das ({TICKET_BONUSES.map((b) => b.label.toLowerCase()).join(', ')}) y recibe un ticket para
        reservarla eligiendo solo día y hora. No paga nada más. El ticket dura {TICKET_DAYS} días.
      </p>
      <label className="flex items-center gap-3 text-sm font-medium text-gray-900">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="goal-enabled" className="h-4 w-4" />
        Mostrar la meta en mi perfil
      </label>
      <label className="block text-sm mt-4">
        <span className="font-semibold text-gray-900">Cuánto debe dar cada fan</span>
        <span className="mt-1 flex items-center gap-2">
          <span className="text-gray-500">$</span>
          <input
            type="number"
            min={GOAL_MIN}
            max={GOAL_MAX}
            step={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            data-testid="goal-target"
            className="w-32 rounded-xl border border-gray-200 px-3 py-2"
          />
          <span className="text-xs text-gray-500">Entre {money(GOAL_MIN)} y {money(GOAL_MAX)}. Ponla al menos al precio de la experiencia.</span>
        </span>
      </label>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-gray-900">Experiencias que se pueden ganar</legend>
        {experiences.length === 0 ? (
          <p className="text-sm text-gray-500 mt-1">Primero crea una experiencia 1:1 o de Reserve activa en la pestaña Reserve.</p>
        ) : (
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            {experiences.map((e) => (
              <label key={e.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${ids.includes(e.id) ? 'border-pink-400 bg-pink-50' : 'border-gray-100'}`}>
                <input type="checkbox" checked={ids.includes(e.id)} onChange={() => toggle(e.id)} data-testid="goal-experience" className="h-4 w-4" />
                <span className="flex-1 text-gray-900">{e.title}</span>
                <span className="text-xs text-gray-500">{money(e.price)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-3 text-sm text-green-700" data-testid="goal-saved">{notice}</p>}
      <button type="button" onClick={save} disabled={saving} data-testid="goal-save" className="mt-4 h-11 rounded-full bg-gray-900 px-6 text-sm font-semibold text-white disabled:opacity-60">
        {saving ? 'Guardando…' : 'Guardar meta'}
      </button>
    </div>
  );
};

export default ExperienceGoalSettings;
