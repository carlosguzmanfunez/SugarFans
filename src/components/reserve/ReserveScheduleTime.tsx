import React from 'react';
import { formatLongDate } from '../../lib/vip';
import { viewerSlotLabel, viewerTimeZone, zoneCity } from '../../lib/timeZones';

const ReserveScheduleTime: React.FC<{ date: string; time: string; zone?: string }> = ({ date, time, zone }) => {
  if (!date || !time) return null;
  const local = viewerSlotLabel(date, time, zone);
  return (
    <span className="block" data-testid="reserve-schedule-time">
      <span className="first-letter:uppercase">{formatLongDate(date)} · {time}{zone ? ` · hora de ${zoneCity(zone)}` : ''}</span>
      {local && <span className="mt-1 block font-semibold" data-testid="booking-local-time">Tu hora: {local} · {zoneCity(viewerTimeZone())}</span>}
    </span>
  );
};
export default ReserveScheduleTime;
