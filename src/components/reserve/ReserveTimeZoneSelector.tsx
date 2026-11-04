import React, { useMemo } from 'react';
import { timeZoneOptions, zoneCity } from '../../lib/timeZones';

// A saved choice, not the device's current clock. Travelling must not move a schedule.
const ReserveTimeZoneSelector: React.FC<{ value: string; onChange: (zone: string) => void; name?: string }> = ({ value, onChange, name = 'reserveTimeZone' }) => {
  const options = useMemo(() => [...new Set([...timeZoneOptions(), ...(value ? [value] : [])])], [value]);
  return (
    <label className="block text-sm">
      <span className="font-semibold text-ink">Ciudad o zona horaria de tus horarios</span>
      <select name={name} value={value} onChange={e => onChange(e.target.value)} className="mt-1 block w-full rounded-xl border border-line px-3 py-2.5 text-base" required>
        <option value="" disabled>Elige tu zona horaria</option>
        {options.map(zone => <option key={zone} value={zone}>{zoneCity(zone)}</option>)}
      </select>
      <span className="mt-2 block text-sm text-ink/70">Elige dónde realizarás las experiencias. Los fans también verán la hora que les corresponde. Un país puede tener varias zonas horarias.</span>
    </label>
  );
};
export default ReserveTimeZoneSelector;
