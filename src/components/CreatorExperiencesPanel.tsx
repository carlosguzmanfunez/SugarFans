import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { usePlatformQuery, platformChanged, money } from '../lib/platform';
import {
  EXPERIENCE_TYPES,
  DEFAULT_EXPERIENCE_IMAGE,
  MIN_EXPERIENCE_PRICE,
  MAX_EXPERIENCE_PRICE,
  type ExperienceType,
  type VipExperience,
  type VipExperienceInput,
} from '../lib/vip';

const blank = (): VipExperienceInput => ({
  title: '',
  description: '',
  type: 'meet-greet',
  price: 50,
  durationMinutes: 30,
  image: DEFAULT_EXPERIENCE_IMAGE,
  active: true,
});

// The creator's own VIP experiences: fans book them on the VIP page.
const CreatorExperiencesPanel: React.FC = () => {
  const { user } = useAuth();
  const profileId = user?.creatorProfileId ?? '';
  const { data: all, reload } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const mine = all.filter((e) => e.creatorProfileId === profileId);
  const [editing, setEditing] = useState<{ id?: string; input: VipExperienceInput } | null>(null);
  const [price, setPrice] = useState('');
  const [live, setLive] = useState(true);
  const [minutes, setMinutes] = useState('30');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user || user.role !== 'creator') return null;

  const open = (exp?: VipExperience) => {
    const input = exp ? { ...exp } : blank();
    setEditing({ id: exp?.id, input });
    setPrice(String(input.price));
    setLive(input.durationMinutes !== undefined);
    setMinutes(String(input.durationMinutes ?? 30));
    setMessage(null);
  };

  const set = (patch: Partial<VipExperienceInput>) => editing && setEditing({ ...editing, input: { ...editing.input, ...patch } });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const input: VipExperienceInput = {
      ...editing.input,
      price: Number(price),
      durationMinutes: live ? Number(minutes) : undefined,
      image: editing.input.image.trim() || DEFAULT_EXPERIENCE_IMAGE,
    };
    const result = await backend.saveExperience(user, input, editing.id);
    if (!result.ok) return setMessage({ ok: false, text: result.error || 'No se pudo guardar' });
    setEditing(null);
    setMessage({ ok: true, text: 'Experiencia guardada.' });
    platformChanged();
    reload();
  };

  const toggleActive = async (exp: VipExperience) => {
    const result = await backend.saveExperience(user, { ...exp, active: !exp.active }, exp.id);
    setMessage(result.ok ? null : { ok: false, text: result.error || 'No se pudo actualizar' });
    platformChanged();
    reload();
  };

  const remove = async (exp: VipExperience) => {
    if (!window.confirm(`¿Eliminar "${exp.title}"? Las reservas ya hechas se mantienen.`)) return;
    const result = await backend.deleteExperience(user, exp.id);
    setMessage(result.ok ? { ok: true, text: 'Experiencia eliminada.' } : { ok: false, text: result.error || 'No se pudo eliminar' });
    platformChanged();
    reload();
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 lg:col-span-2" data-testid="vip-experiences-admin">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-bold text-gray-900">Mis experiencias VIP</h3>
          <p className="text-sm text-gray-500">Los fans las ven en la página VIP y las reservan en tus horarios. Recibes el 80% de cada pago.</p>
        </div>
        {!editing && (
          <button onClick={() => open()} className="shrink-0 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-xl text-sm font-medium">
            <i aria-hidden="true" className="fas fa-plus mr-1"></i> Nueva experiencia
          </button>
        )}
      </div>

      {message && (
        <div role="status" className={`mb-4 px-4 py-3 rounded-xl text-sm border ${message.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="border border-purple-100 rounded-xl p-4 mb-4 space-y-3" data-testid="experience-form">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-gray-700 font-medium">Título</span>
              <input name="expTitle" value={editing.input.title} onChange={(e) => set({ title: e.target.value })} maxLength={80} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </label>
            <label className="block text-sm">
              <span className="text-gray-700 font-medium">Tipo</span>
              <select name="expType" value={editing.input.type} onChange={(e) => set({ type: e.target.value as ExperienceType })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                {EXPERIENCE_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-gray-700 font-medium">Descripción</span>
            <textarea name="expDescription" rows={3} value={editing.input.description} onChange={(e) => set({ description: e.target.value })} maxLength={600} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="block text-sm">
              <span className="text-gray-700 font-medium">Precio (USD)</span>
              <input name="expPrice" type="number" min={MIN_EXPERIENCE_PRICE} max={MAX_EXPERIENCE_PRICE} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              Incluye videollamada en vivo
            </label>
            {live && (
              <label className="block text-sm">
                <span className="text-gray-700 font-medium">Duración (min)</span>
                <input name="expMinutes" type="number" min={10} max={180} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </label>
            )}
          </div>
          <label className="block text-sm">
            <span className="text-gray-700 font-medium">Imagen (URL, opcional)</span>
            <input name="expImage" value={editing.input.image} onChange={(e) => set({ image: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </label>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600">Cancelar</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium">Guardar experiencia</button>
          </div>
        </form>
      )}

      {mine.length === 0 ? (
        <p className="text-sm text-gray-500">Aún no tienes experiencias. Crea la primera para que los fans puedan reservarla.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {mine.map((exp) => (
            <div key={exp.id} data-testid="my-experience" className="py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {exp.title}
                  {!exp.active && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Oculta</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {money(exp.price)} · {exp.durationMinutes ? `${exp.durationMinutes} min en vivo` : 'sin sesión en vivo'}
                </p>
              </div>
              <div className="flex gap-3 text-xs">
                <button onClick={() => open(exp)} className="text-purple-600 hover:text-purple-700">Editar</button>
                <button onClick={() => toggleActive(exp)} className="text-gray-600 hover:text-gray-800">{exp.active ? 'Ocultar' : 'Mostrar'}</button>
                <button onClick={() => remove(exp)} className="text-red-600 hover:text-red-700">Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CreatorExperiencesPanel;
