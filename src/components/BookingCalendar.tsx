import React, { useMemo, useState } from 'react';
import {
  bookingWindow,
  fromISODate,
  toISODate,
  freeHoursOn,
  takenHoursOn,
  formatLongDate,
  WEEKDAYS,
  MAX_BOOKING_MONTHS,
  type Availability,
  type TakenSlot,
} from '../lib/vip';

interface Props {
  availability: Availability;
  taken: TakenSlot[];
  creatorName: string;
  date: string;
  time: string;
  onChange: (date: string, time: string) => void;
  // Hours closer than this to now are not offered (the experience's minimum notice).
  minNoticeHours?: number;
}

// Month calendar limited to the bookable window; only the creator's working
// days are selectable, and only their free hours are offered.
const BookingCalendar: React.FC<Props> = ({ availability, taken: takenSlots, creatorName, date, time, onChange, minNoticeHours = 0 }) => {
  const { min, max } = bookingWindow();
  const minDate = fromISODate(min);
  const maxDate = fromISODate(max);
  const [month, setMonth] = useState(() => {
    const base = date ? fromISODate(date) : minDate;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const canPrev = month > new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const canNext = month < new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const blanks = Array.from({ length: first.getDay() }, () => null);
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const iso = toISODate(new Date(month.getFullYear(), month.getMonth(), i + 1));
      return { iso, day: i + 1, free: freeHoursOn(availability, takenSlots, iso, minNoticeHours).length > 0 };
    });
    return [...blanks, ...days];
  }, [month, availability, takenSlots, minNoticeHours]);

  const monthLabel = month.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  const taken = date ? takenHoursOn(takenSlots, date) : [];
  const free = date ? freeHoursOn(availability, takenSlots, date, minNoticeHours) : [];

  if (availability.days.length === 0 || availability.hours.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
        {creatorName} todavía no ha publicado horarios disponibles.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="booking-calendar">
      <div className="border border-gray-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            aria-label="Mes anterior"
            disabled={!canPrev}
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="w-9 h-9 rounded-full hover:bg-purple-50 text-purple-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ‹
          </button>
          <span className="font-semibold text-gray-900 capitalize" data-testid="calendar-month">{monthLabel}</span>
          <button
            type="button"
            aria-label="Mes siguiente"
            disabled={!canNext}
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="w-9 h-9 rounded-full hover:bg-purple-50 text-purple-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-400 mb-1">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) =>
            cell === null ? (
              <span key={`blank-${i}`} />
            ) : (
              <button
                key={cell.iso}
                type="button"
                data-date={cell.iso}
                disabled={!cell.free}
                onClick={() => onChange(cell.iso, '')}
                className={`h-10 rounded-xl text-sm transition ${
                  cell.iso === date
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold shadow'
                    : cell.free
                      ? 'bg-purple-50 text-purple-800 font-medium hover:bg-purple-100'
                      : 'text-gray-300 cursor-not-allowed'
                }`}
              >
                {cell.day}
              </button>
            ),
          )}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          <span className="inline-block w-3 h-3 rounded bg-purple-50 border border-purple-200 align-middle mr-1"></span>
          Días con horario disponible. Puedes reservar con hasta {MAX_BOOKING_MONTHS} meses de antelación (hasta el{' '}
          {fromISODate(max).toLocaleDateString('es', { day: 'numeric', month: 'long' })}).
        </p>
      </div>

      {date && (
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2 first-letter:uppercase">{formatLongDate(date)}</p>
          <div className="flex flex-wrap gap-2" data-testid="time-slots">
            {availability.hours.map((h) => {
              const isTaken = taken.includes(h);
              const isFree = free.includes(h);
              return (
                <button
                  key={h}
                  type="button"
                  disabled={!isFree}
                  aria-pressed={time === h}
                  onClick={() => onChange(date, h)}
                  title={isTaken ? 'Ya reservado' : undefined}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
                    time === h
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white border-transparent'
                      : isFree
                        ? 'border-purple-200 text-purple-700 hover:bg-purple-50'
                        : 'border-gray-100 text-gray-300 line-through cursor-not-allowed'
                  }`}
                >
                  {h}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingCalendar;
