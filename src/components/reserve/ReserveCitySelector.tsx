import React, { useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../context/AuthContext';
import { backend } from '../../lib/backend';
import { attendanceLocation, inPerson, locationLabel, locationText, validReserveLocation, type AttendanceLocation, type ReserveLocation } from '../../lib/reserveLocation';
import { countryName } from '../../config/countries';

const KEY = 'fansreserve_reserve_destination_v1';
const EVENT = 'reserve:destination';
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
};
const snapshot = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const useReserveDestination = () => {
  const { user } = useAuth();
  const saved = useSyncExternalStore(subscribe, snapshot, () => null);
  if (user) return attendanceLocation(user);
  try {
    const d = JSON.parse(saved ?? 'null') as AttendanceLocation | null;
    return validReserveLocation(d) && d.confirmedAt ? d : null;
  } catch { return null; }
};

// Choose from the creator's published destinations: no mistyped or inferred city.
const ReserveCitySelector: React.FC<{ experiences: { active: boolean; details?: Partial<ReserveLocation> & { modality?: string } }[] }> = ({ experiences }) => {
  const { user, refreshUser } = useAuth();
  const selected = useReserveDestination();
  const [editing, setEditing] = useState(false);
  const [country, setCountry] = useState('');
  const [choice, setChoice] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const places = new Map<string, ReserveLocation>();
  for (const exp of experiences) {
    const d = exp.details;
    if (exp.active && inPerson(d) && validReserveLocation(d))
      places.set(JSON.stringify([d.country, locationText(d.region), locationText(d.city)]), { country: d.country, region: d.region, city: d.city });
  }
  const options = [...places.entries()].sort((a, b) => locationLabel(a[1]).localeCompare(locationLabel(b[1]), 'es'));
  if (!options.length) return null;
  const countries = [...new Set(options.map(([, d]) => d.country))].sort((a, b) => countryName(a, 'es', '').localeCompare(countryName(b, 'es', ''), 'es'));
  const save = async () => {
    const d = places.get(choice);
    if (!d || !confirmed) return setError('Elige la ciudad y confirma que podrás asistir allí.');
    setBusy(true); setError('');
    try {
      if (user) {
        const r = await backend.selectAttendanceLocation(user, d);
        if (!r.ok) { setError(r.error || 'No se pudo guardar la ciudad. Inténtalo de nuevo.'); return; }
        await refreshUser();
      } else {
        localStorage.setItem(KEY, JSON.stringify({ ...d, confirmedAt: new Date().toISOString() }));
        window.dispatchEvent(new Event(EVENT));
      }
      setEditing(false);
    } catch { setError('No se pudo guardar la ciudad. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  };
  return (
    <section aria-label="Ciudad de asistencia" className="my-4 rounded-2xl border border-line bg-white p-4 text-ink" data-testid="reserve-city-selector">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="min-w-0 break-words text-sm font-semibold">{selected ? `Presenciales en ${locationLabel(selected)}` : '¿En qué ciudad asistirás?'}</p>
        {selected && !editing && <button type="button" onClick={() => { setEditing(true); setCountry(selected.country); setChoice(''); setConfirmed(false); }} className="min-h-11 px-3 text-sm font-semibold underline underline-offset-4">Cambiar ciudad</button>}
      </div>
      {(!selected || editing) && <div className="mt-3 space-y-3">
        <p className="text-sm text-ink/75">Elige la ciudad donde estarás, aunque viajes. Verás las experiencias presenciales de esa ciudad y todas las virtuales.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">País
            <select aria-label="País de asistencia" value={country} disabled={busy} onChange={(e) => { setCountry(e.target.value); setChoice(''); setConfirmed(false); }} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base">
              <option value="">Selecciona un país</option>
              {countries.map((c) => <option key={c} value={c}>{countryName(c, 'es', '')}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Ciudad y departamento o estado
            <select aria-label="Ciudad de asistencia" value={choice} disabled={!country || busy} onChange={(e) => { setChoice(e.target.value); setConfirmed(false); }} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base disabled:bg-gray-50">
              <option value="">Selecciona una ciudad</option>
              {options.filter(([, d]) => d.country === country).map(([key, d]) => <option key={key} value={key}>{d.city}, {d.region}</option>)}
            </select>
          </label>
        </div>
        <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />Confirmo que podré asistir en la ciudad seleccionada.</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={!choice || !confirmed || busy} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Confirmar ciudad'}</button>
          {selected && <button type="button" disabled={busy} onClick={() => setEditing(false)} className="min-h-11 rounded-full border border-line px-5 text-sm">Cancelar</button>}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>}
    </section>
  );
};
export default ReserveCitySelector;
