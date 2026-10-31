import React, { useEffect, useMemo, useState } from 'react';
import { backend } from '../lib/backend';
import { readJSON, writeJSON } from '../lib/storage';
import {
  DEFAULT_TEMPLATES, NETWORKS, PILOT_COUNTRIES, SOURCES, STATUSES, TEMPLATE_HEADER, compact, countryLabel, fillTemplate, parseProspectList,
  type Prospect, type ProspectNetwork, type ProspectSource, type Templates,
} from '../lib/prospects';
import { AdminDialog } from './AdminDialog';

const TEMPLATES_KEY = 'prospect_templates';
export const loadTemplates = (): Templates => ({ ...DEFAULT_TEMPLATES, ...readJSON<Partial<Templates>>(TEMPLATES_KEY, {}) });

export const flag = (code?: string) => (code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0))) : '🌎');

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
const label = 'block text-sm font-medium text-gray-800 mb-1';
const primary = 'min-h-11 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50';
const secondary = 'min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50';

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export { download };

/* ---------- Import ---------- */

export function ImportDialog({ onClose, onDone, country }: { onClose: () => void; onDone: (text: string) => void; country?: string }) {
  const [source, setSource] = useState<ProspectSource>('heepsy');
  const [network, setNetwork] = useState<ProspectNetwork>('instagram');
  const [defaultCountry, setDefaultCountry] = useState(country ?? '');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => (text.trim() ? parseProspectList(text, { network, country: defaultCountry || undefined }) : null), [text, network, defaultCountry]);
  const withoutCountry = parsed?.rows.filter((r) => !r.country).length ?? 0;

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError('El archivo pesa más de 8 MB. Divídelo en partes.'); return; }
    setError(''); setFileName(file.name); setText(await file.text());
  };
  const run = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true); setError('');
    const result = await backend.prospects.importRows(parsed.rows, source);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onDone(`Listo: ${result.inserted.toLocaleString('es-HN')} creadores nuevos${result.updated ? `, ${result.updated.toLocaleString('es-HN')} actualizados` : ''}${result.skipped ? ` y ${result.skipped} sin datos válidos` : ''}.`);
  };

  return <AdminDialog title="Importar una lista de creadores" onClose={onClose} busy={busy} wide>
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">Sirve la exportación de Heepsy o Modash, una hoja de Excel o Google Sheets guardada como CSV, o una columna de usuarios pegada. Si alguien ya está en la lista, solo se actualizan sus números: su estado y tus notas no cambian.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className={label} htmlFor="imp-source">De dónde viene</label>
          <select id="imp-source" className={field} value={source} onChange={(e) => setSource(e.target.value as ProspectSource)}>
            {(Object.keys(SOURCES) as ProspectSource[]).map((s) => <option key={s} value={s}>{SOURCES[s]}</option>)}
          </select></div>
        <div><label className={label} htmlFor="imp-network">Red, si la lista no la dice</label>
          <select id="imp-network" className={field} value={network} onChange={(e) => setNetwork(e.target.value as ProspectNetwork)}>
            {(Object.keys(NETWORKS) as ProspectNetwork[]).map((n) => <option key={n} value={n}>{NETWORKS[n].label}</option>)}
          </select></div>
        <div><label className={label} htmlFor="imp-country">País, si la lista no lo dice</label>
          <select id="imp-country" className={field} value={defaultCountry} onChange={(e) => setDefaultCountry(e.target.value)}>
            <option value="">Sin país</option>
            {PILOT_COUNTRIES.map((c) => <option key={c} value={c}>{flag(c)} {countryLabel(c)}</option>)}
          </select></div>
      </div>

      <div className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4">
        <label className="flex flex-col items-center gap-2 text-center cursor-pointer" htmlFor="imp-file">
          <i aria-hidden="true" className="fas fa-file-csv text-2xl text-gray-500" />
          <span className="font-medium text-gray-900">{fileName || 'Elige un archivo CSV'}</span>
          <span className="text-xs text-gray-500">o pega la lista abajo</span>
        </label>
        <input id="imp-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
      </div>
      <div><label className={label} htmlFor="imp-text">Lista</label>
        <textarea id="imp-text" rows={5} className={`${field} font-mono text-xs`} value={text} onChange={(e) => { setText(e.target.value); setFileName(''); }}
          placeholder={'usuario,seguidores,pais\n@ana.fit,25000,Honduras\n@luis_baila,48000,Honduras'} /></div>
      <button type="button" className="text-pink-800 underline underline-offset-4 min-h-11" onClick={() => download('plantilla-creadores.csv', `${TEMPLATE_HEADER}\nHN,Tegucigalpa,Ana,instagram,@ana.fit,https://instagram.com/ana.fit,25000,fitness,,4.5,\n`)}>
        Descargar la plantilla vacía
      </button>

      {parsed && <div className="rounded-xl bg-white border border-gray-200 p-4" aria-live="polite">
        <p className="font-semibold text-gray-900">{parsed.rows.length.toLocaleString('es-HN')} creadores listos para importar</p>
        <p className="text-gray-600 mt-1">
          {[parsed.duplicates && `${parsed.duplicates} ${parsed.duplicates === 1 ? 'repetido' : 'repetidos'} en el archivo`, parsed.invalid && `${parsed.invalid} ${parsed.invalid === 1 ? 'fila' : 'filas'} sin usuario`, withoutCountry && `${withoutCountry} sin país`].filter(Boolean).join(' · ') || 'Todo en orden.'}
        </p>
        {parsed.rows.length > 0 && <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500"><th className="py-1 pr-3 font-medium">Usuario</th><th className="pr-3 font-medium">Red</th><th className="pr-3 font-medium">País</th><th className="pr-3 font-medium text-right">Seguidores</th><th className="font-medium">Correo</th></tr></thead>
            <tbody>{parsed.rows.slice(0, 5).map((r) => <tr key={`${r.network}${r.handle}`} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 font-medium">@{r.handle}</td><td className="pr-3">{NETWORKS[r.network].label}</td>
              <td className="pr-3">{r.country ? `${flag(r.country)} ${r.country}` : '—'}</td><td className="pr-3 text-right tabular-nums">{compact(r.followers)}</td><td>{r.email ?? '—'}</td>
            </tr>)}</tbody>
          </table>
          {parsed.rows.length > 5 && <p className="text-xs text-gray-500 mt-2">y {(parsed.rows.length - 5).toLocaleString('es-HN')} más</p>}
        </div>}
      </div>}

      {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className={primary} onClick={() => void run()} disabled={busy || !parsed?.rows.length}>
          {busy ? 'Importando…' : `Importar ${parsed?.rows.length ? parsed.rows.length.toLocaleString('es-HN') : ''}`}
        </button>
      </div>
    </div>
  </AdminDialog>;
}

/* ---------- Writing to one creator ---------- */

type Kind = 'dm' | 'email' | 'followUp';

export function MessageDialog({ prospect, onClose, onChanged }: { prospect: Prospect; onClose: () => void; onChanged: (text: string) => void }) {
  const templates = loadTemplates();
  const first: Kind = prospect.status === 'contactado' ? 'followUp' : prospect.email && prospect.network !== 'instagram' && prospect.network !== 'tiktok' ? 'email' : 'dm';
  const [kind, setKind] = useState<Kind>(first);
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState(prospect.notes ?? '');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'no_contactar' | 'remove' | null>(null);
  const blocked = prospect.status === 'no_contactar';
  const network = NETWORKS[prospect.network];

  useEffect(() => {
    setText(fillTemplate(kind === 'dm' ? templates.dm : kind === 'email' ? templates.email : templates.followUp, prospect));
    setSubject(fillTemplate(templates.emailSubject, prospect));
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, prospect.id]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setError('No se pudo copiar. Selecciona el texto y cópialo a mano.'); }
  };
  const save = async (patch: Parameters<typeof backend.prospects.update>[1], done: string) => {
    setBusy(true); setError('');
    const r = await backend.prospects.update(prospect.id, { ...patch, notes });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return; }
    onChanged(done);
  };
  const remove = async () => {
    setBusy(true);
    const r = await backend.prospects.remove(prospect.id);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se pudo borrar.'); return; }
    onChanged(`Se borraron los datos de @${prospect.handle}.`);
  };
  const mailto = `mailto:${prospect.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const tabs: { id: Kind; label: string; hidden?: boolean }[] = [
    { id: 'dm', label: `DM de ${network.label}` },
    { id: 'email', label: 'Correo', hidden: !prospect.email },
    { id: 'followUp', label: 'Seguimiento', hidden: prospect.status === 'nuevo' },
  ];

  if (confirm) return <AdminDialog title={confirm === 'remove' ? `Borrar a @${prospect.handle}` : `No volver a escribir a @${prospect.handle}`} onClose={() => setConfirm(null)} busy={busy}>
    <div className="space-y-3 text-sm">
      {confirm === 'remove'
        ? <p>Se borra todo lo que guardamos de esta persona. Úsalo si pide que eliminemos sus datos. Si vuelve a aparecer en una lista importada, entraría de nuevo como nueva.</p>
        : <p>Queda marcada como <b>No contactar</b> y se borran su correo, su bio y tus notas. Si vuelve a aparecer en una lista importada, sigue sin datos de contacto y nadie del equipo le vuelve a escribir.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondary} onClick={() => setConfirm(null)} disabled={busy}>Volver</button>
        <button type="button" className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}
          onClick={() => void (confirm === 'remove' ? remove() : save({ status: 'no_contactar' }, `@${prospect.handle} quedó en No contactar.`))}>
          {confirm === 'remove' ? 'Borrar sus datos' : 'Confirmar'}
        </button>
      </div>
    </div>
  </AdminDialog>;

  return <AdminDialog title={`Escribir a @${prospect.handle}`} onClose={onClose} busy={busy} wide>
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600">
        <span><i aria-hidden="true" className={`${network.icon} mr-1`} />{prospect.displayName ?? network.label}</span>
        <span>{flag(prospect.country)} {countryLabel(prospect.country)}</span>
        <span className="tabular-nums">{compact(prospect.followers)} seguidores</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUSES[prospect.status].tone}`}>{STATUSES[prospect.status].label}</span>
      </div>

      {blocked ? <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">Pidió que no le escribamos. No le envíes mensajes.</p> : <>
        <div role="tablist" aria-label="Tipo de mensaje" className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
          {tabs.filter((t) => !t.hidden).map((t) => <button key={t.id} type="button" role="tab" aria-selected={kind === t.id} onClick={() => setKind(t.id)}
            className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium ${kind === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{t.label}</button>)}
        </div>
        {kind === 'email' && <div><label className={label} htmlFor="msg-subject">Asunto</label><input id="msg-subject" className={field} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>}
        <div>
          <label className={label} htmlFor="msg-text">Mensaje <span className="font-normal text-gray-500">(puedes ajustarlo antes de copiar)</span></label>
          <textarea id="msg-text" rows={kind === 'email' ? 11 : 8} className={field} value={text} onChange={(e) => { setText(e.target.value); setCopied(false); }} />
          <p className="mt-1 text-xs text-gray-500">Sin enlaces en el primer mensaje: el enlace va cuando responda. Así es menos probable que lo tomen como spam.</p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-3">
          <li><button type="button" className={`${secondary} w-full`} onClick={() => void copy()}>
            <i aria-hidden="true" className={`fas ${copied ? 'fa-check text-emerald-600' : 'fa-copy'} mr-2`} />{copied ? 'Copiado' : '1. Copiar mensaje'}</button></li>
          <li>{kind === 'email'
            ? <a className={`${secondary} w-full inline-flex items-center justify-center`} href={mailto}><i aria-hidden="true" className="fas fa-envelope mr-2" />2. Abrir el correo</a>
            : <a className={`${secondary} w-full inline-flex items-center justify-center`} href={network.url(prospect.handle)} target="_blank" rel="noopener noreferrer"><i aria-hidden="true" className={`${network.icon} mr-2`} />2. Abrir su perfil</a>}</li>
          <li>{kind === 'followUp'
            ? <button type="button" className={`${primary} w-full`} disabled={busy} onClick={() => void save({ followUps: prospect.followUps + 1 }, `Seguimiento a @${prospect.handle} anotado.`)}>3. Ya le envié el seguimiento</button>
            : <button type="button" className={`${primary} w-full`} disabled={busy || prospect.status !== 'nuevo'}
              onClick={() => void save({ status: 'contactado', channel: kind === 'email' ? 'email' : 'dm' }, `@${prospect.handle} quedó como contactado.`)}>
              {prospect.status === 'nuevo' ? '3. Ya se lo envié' : 'Ya está contactado'}</button>}</li>
        </ol>
      </>}

      <div><label className={label} htmlFor="msg-notes">Notas del equipo</label>
        <textarea id="msg-notes" rows={2} className={field} value={notes} maxLength={1000} disabled={blocked} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: le interesa, pidió más detalles por WhatsApp" /></div>

      {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap gap-2">
          {(prospect.status === 'contactado' || prospect.status === 'nuevo') && <button type="button" className={secondary} disabled={busy} onClick={() => void save({ status: 'respondio' }, `@${prospect.handle} respondió. 🎉`)}>Respondió</button>}
          {!blocked && prospect.status !== 'descartado' && ['nuevo', 'contactado', 'respondio'].includes(prospect.status) && <button type="button" className={secondary} disabled={busy} onClick={() => void save({ status: 'descartado' }, `@${prospect.handle} quedó descartado.`)}>No encaja</button>}
          {prospect.status === 'descartado' && <button type="button" className={secondary} disabled={busy} onClick={() => void save({ status: 'nuevo' }, `@${prospect.handle} volvió a Por contactar.`)}>Volver a la lista</button>}
          {!blocked && <button type="button" className={`${secondary} text-red-700`} disabled={busy} onClick={() => setConfirm('no_contactar')}>No quiere que le escribamos</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 px-3 text-sm text-gray-500 underline underline-offset-4" onClick={() => setConfirm('remove')}>Borrar sus datos</button>
          {!blocked && <button type="button" className={secondary} disabled={busy || notes === (prospect.notes ?? '')} onClick={() => void save({}, 'Notas guardadas.')}>Guardar notas</button>}
        </div>
      </div>
    </div>
  </AdminDialog>;
}

/* ---------- Templates ---------- */

export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const [t, setT] = useState<Templates>(loadTemplates);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof Templates) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => { setT({ ...t, [k]: e.target.value }); setSaved(false); };
  return <AdminDialog title="Plantillas de mensajes" onClose={onClose} wide>
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">Se completan solas con los datos de cada creador: <code className="rounded bg-gray-100 px-1">{'{nombre}'}</code> (su primer nombre), <code className="rounded bg-gray-100 px-1">{'{usuario}'}</code>, <code className="rounded bg-gray-100 px-1">{'{pais}'}</code> y <code className="rounded bg-gray-100 px-1">{'{categoria}'}</code>. Se guardan en este navegador.</p>
      <div><label className={label} htmlFor="tpl-dm">Primer mensaje por Instagram, TikTok o Facebook</label><textarea id="tpl-dm" rows={7} className={field} value={t.dm} onChange={set('dm')} /></div>
      <div><label className={label} htmlFor="tpl-subject">Asunto del correo</label><input id="tpl-subject" className={field} value={t.emailSubject} onChange={set('emailSubject')} /></div>
      <div><label className={label} htmlFor="tpl-email">Correo</label><textarea id="tpl-email" rows={10} className={field} value={t.email} onChange={set('email')} /></div>
      <div><label className={label} htmlFor="tpl-follow">Seguimiento (una sola vez, a los 5 días)</label><textarea id="tpl-follow" rows={4} className={field} value={t.followUp} onChange={set('followUp')} /></div>
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className="min-h-11 px-2 text-gray-600 underline underline-offset-4" onClick={() => { setT(DEFAULT_TEMPLATES); setSaved(false); }}>Volver a los textos originales</button>
        <div className="flex gap-2">
          <button type="button" className={secondary} onClick={onClose}>Cerrar</button>
          <button type="button" className={primary} onClick={() => { writeJSON(TEMPLATES_KEY, t); setSaved(true); }}>{saved ? 'Guardado ✓' : 'Guardar plantillas'}</button>
        </div>
      </div>
    </div>
  </AdminDialog>;
}
