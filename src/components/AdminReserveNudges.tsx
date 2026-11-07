import React from 'react';
import { backend } from '../lib/backend';
import { useBackendData } from '../lib/useBackendData';
import { useLanguage } from '../context/LanguageContext';
import { nudgeChannels, nudgeStateKey, type ReserveResponseLog } from '../lib/reserveResponseReminders';
import { attendanceDate } from '../lib/adminReserveAttendance';

const empty: ReserveResponseLog = { as_of: '', items: [] };
const control = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700 disabled:opacity-50';
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

// Admin > Asistencia de Reserve: every reminder sent to a creator about a request
// still without answer, and what happened with each channel (proof of delivery).
export default function AdminReserveNudges({ refreshToken = 0 }: { refreshToken?: number }) {
  const { t } = useLanguage();
  const { data, loading, error, reload } = useBackendData(() => backend.reserveResponseLog(7), [refreshToken], empty);
  const now = data.as_of ? Date.parse(data.as_of) : Date.now();
  return (
    <section className="rounded-2xl border border-gray-200 bg-white" aria-labelledby="nudges-title" data-testid="admin-reserve-nudges">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 p-4 sm:p-5">
        <div className="max-w-2xl">
          <h2 id="nudges-title" className="text-lg font-bold text-gray-900">{t('admin.nudge.title')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('admin.nudge.intro')}</p>
        </div>
        <button type="button" onClick={() => void reload()} disabled={loading} className={control}>{t('admin.nudge.refresh')}</button>
      </div>
      {loading ? (
        <p role="status" className="p-5 text-sm text-gray-600">{t('admin.nudge.loading')}</p>
      ) : error ? (
        <p role="alert" className="p-5 text-sm text-amber-900">{t('admin.nudge.error')}</p>
      ) : !data.items.length ? (
        <p className="p-5 text-sm text-gray-600">{t('admin.nudge.empty')}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.items.map((b) => (
            <li key={b.booking_id} className="p-4 sm:px-5" data-testid="admin-nudge-row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold text-gray-900">{b.title}</h3>
                  <p className="mt-1 break-words text-sm text-gray-700">{fill(t('admin.nudge.people'), { creator: b.creator_name, fan: b.fan_name })}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {b.respond_by && fill(t('admin.nudge.deadline'), { date: attendanceDate(b.respond_by) })} · {t(b.seen_at ? 'admin.nudge.seen' : 'admin.nudge.notSeen')}
                  </p>
                </div>
                <span className={`rounded-md px-2 py-1 text-xs font-medium ${b.waiting ? 'bg-amber-50 text-amber-900' : 'bg-gray-100 text-gray-700'}`}>{t(nudgeStateKey(b))}</span>
              </div>
              <ol className="mt-3 space-y-2 text-sm">
                {(b.reminders ?? []).map((m) => (
                  <li key={m.step} className="grid gap-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                    <span className="font-medium text-gray-900">
                      {t(`admin.nudge.step.${m.step}`)}
                      <span className="block text-xs font-normal text-gray-600">{attendanceDate(m.sent_at)}</span>
                    </span>
                    <span className="flex flex-wrap items-start gap-1.5">
                      {nudgeChannels(m, now).map(([key, n, d]) => (
                        <span key={key} className={`rounded-md px-2 py-0.5 text-xs ${/Failed|Unread|None|skipped/.test(key) ? 'bg-amber-50 text-amber-900' : /Pending/.test(key) ? 'bg-gray-100 text-gray-700' : 'bg-green-50 text-green-800'}`}>
                          {fill(t(key), { n: n ?? 0, d: d ?? 0 })}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-gray-200 p-4 text-xs text-gray-600 sm:px-5">{t('admin.nudge.note')}</p>
    </section>
  );
}
