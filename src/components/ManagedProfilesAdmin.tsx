import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  usePlatformQuery,
  platformApi,
  saveManagedProfile,
  setManagedProfileHidden,
  deleteManagedProfile,
  readImageFile,
  money,
  MANAGED_CATEGORIES,
  type ManagedProfile,
  type ManagedProfileInput,
  type Transaction,
} from '../lib/platform';
import { BRAND } from '../config/brand';

const field = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';

const blank: ManagedProfileInput = {
  name: '',
  username: '',
  bio: '',
  avatar: '',
  cover: '',
  category: MANAGED_CATEGORIES[0],
  subscriptionPrice: 9.99,
  isAi: true,
};

const ImagePicker: React.FC<{ name: string; label: string; value: string; maxSize: number; onChange: (v: string) => void; onError: (e: string) => void }> = ({
  name,
  label,
  value,
  maxSize,
  onChange,
  onError,
}) => (
  <div>
    <p className="text-xs font-medium text-gray-600 mb-1">{label}</p>
    <div className="flex items-center gap-2">
      {value && <img src={value} alt="" className="w-10 h-10 rounded-lg object-cover" />}
      <label className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg cursor-pointer">
        Subir imagen
        <input
          type="file"
          name={name}
          accept="image/*"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              onChange(await readImageFile(file, maxSize));
            } catch (err) {
              onError((err as Error).message);
            }
          }}
        />
      </label>
      <input className={`${field} flex-1`} placeholder="…o pega una URL" value={value.startsWith('data:') ? '' : value} onChange={(e) => onChange(e.target.value)} />
    </div>
  </div>
);

// Admin > Perfiles gestionados: platform-run creator profiles (e.g. AI personas).
// They skip identity verification because no real person is behind them, and
// AI personas carry a small "P-IA" tag.
const ManagedProfilesAdmin: React.FC<{ transactions: Transaction[] }> = ({ transactions }) => {
  const { user } = useAuth();
  const { data: profiles } = usePlatformQuery(() => platformApi.managedProfiles(true), [], [] as ManagedProfile[]);
  const [editing, setEditing] = useState<{ id?: string; input: ManagedProfileInput } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const statsOf = (id: string) => {
    const paid = transactions.filter((t) => t.creatorProfileId === id && t.status === 'paid');
    return { revenue: paid.reduce((s, t) => s + t.amount, 0), fans: new Set(paid.map((t) => t.payerId ?? t.payerName)).size };
  };

  const set = <K extends keyof ManagedProfileInput>(key: K, value: ManagedProfileInput[K]) =>
    setEditing((e) => (e ? { ...e, input: { ...e.input, [key]: value } } : e));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const r = await saveManagedProfile(user, editing.input, editing.id);
    setSaving(false);
    if (!r.ok) return setNotice({ ok: false, text: r.error || 'No se pudo guardar el perfil' });
    setNotice({ ok: true, text: editing.id ? 'Perfil actualizado' : 'Perfil creado y publicado en Explorar' });
    setEditing(null);
  };

  const act = async (p: Promise<{ ok: boolean; error?: string }>, okText: string) => {
    const r = await p;
    setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'No se pudo completar la acción' });
  };

  return (
    <div className="space-y-4" data-testid="managed-profiles">
      <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900">Perfiles gestionados por {BRAND.name}</h3>
          <p className="text-sm text-gray-500">
            Perfiles que crea y administra el equipo, por ejemplo personajes generados con IA. No pasan por la verificación de identidad;
            los de IA llevan la etiqueta <span className="font-semibold text-purple-700">P-IA</span>. Sus ingresos son de la plataforma.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => { setEditing({ input: { ...blank } }); setNotice(null); }}
            className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
          >
            <i aria-hidden="true" className="fas fa-plus mr-1"></i> Nuevo perfil
          </button>
        )}
      </div>

      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl border text-sm ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      {editing && (
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3" data-testid="managed-profile-form">
          <h4 className="font-bold text-gray-900">{editing.id ? 'Editar perfil' : 'Nuevo perfil'}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={field} name="managedName" placeholder="Nombre visible" value={editing.input.name} onChange={(e) => set('name', e.target.value)} />
            <input className={field} name="managedUsername" placeholder="usuario (sin @)" value={editing.input.username} onChange={(e) => set('username', e.target.value)} />
            <select className={field} aria-label="Categoría" value={editing.input.category} onChange={(e) => set('category', e.target.value)}>
              {MANAGED_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                className={`${field} pl-8`}
                type="number"
                name="managedPrice"
                min={0.99}
                step="0.01"
                aria-label="Precio mensual"
                value={editing.input.subscriptionPrice}
                onChange={(e) => set('subscriptionPrice', parseFloat(e.target.value))}
              />
            </div>
          </div>
          <textarea className={field} rows={3} name="managedBio" placeholder="Biografía" value={editing.input.bio} onChange={(e) => set('bio', e.target.value)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ImagePicker name="managedAvatar" label="Foto de perfil" value={editing.input.avatar} maxSize={400} onChange={(v) => set('avatar', v)} onError={(t) => setNotice({ ok: false, text: t })} />
            <ImagePicker name="managedCover" label="Portada" value={editing.input.cover} maxSize={1200} onChange={(v) => set('cover', v)} onError={(t) => setNotice({ ok: false, text: t })} />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={editing.input.isAi} onChange={(e) => set('isAi', e.target.checked)} />
            <span>
              Personaje generado con IA
              <span className="block text-xs text-gray-500">
                {editing.input.isAi ? 'Se muestra la etiqueta "P-IA".' : 'Sin etiqueta.'}
              </span>
            </span>
          </label>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
            <button type="button" onClick={save} disabled={saving} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Guardar perfil
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
        {profiles.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aún no hay perfiles gestionados</p>}
        {profiles.map((m) => {
          const stats = statsOf(m.id);
          return (
            <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="managed-row">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <img src={m.avatar} alt={m.name} className="w-12 h-12 rounded-full object-cover" />
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {m.name}{' '}
                    {m.isAi && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">P-IA</span>}
                    {m.hidden && <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Oculto</span>}
                  </p>
                  <p className="text-xs text-gray-500">@{m.username} • {m.category} • {money(m.subscriptionPrice)}/mes</p>
                  <p className="text-xs text-gray-500">{stats.fans} fans han pagado • {money(stats.revenue)} cobrados</p>
                </div>
              </div>
              <div className="flex gap-2 text-xs">
                <Link to={`/creator/${m.id}`} className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200">Ver</Link>
                <button
                  type="button"
                  onClick={() => {
                    const { id, hidden: _h, createdAt: _c, createdBy: _b, updatedAt: _u, ...input } = m;
                    setEditing({ id, input });
                    setNotice(null);
                  }}
                  className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => act(setManagedProfileHidden(user, m.id, !m.hidden), m.hidden ? 'Perfil visible de nuevo' : 'Perfil oculto de Explorar')}
                  className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  {m.hidden ? 'Mostrar' : 'Ocultar'}
                </button>
                <button
                  type="button"
                  onClick={() => window.confirm(`¿Eliminar el perfil ${m.name}?`) && act(deleteManagedProfile(user, m.id), 'Perfil eliminado')}
                  className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
                >
                  Eliminar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ManagedProfilesAdmin;
