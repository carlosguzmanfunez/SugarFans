import React, { useEffect, useMemo, useState } from 'react';
import { backend } from '../lib/backend';
import { readJSON, writeJSON } from '../lib/storage';
import {
  DEFAULT_TEMPLATES, NETWORKS, PILOT_COUNTRIES, SOURCES, STATUSES, TEMPLATE_HEADER, compact, countryLabel, emailBatchCsv, fillTemplate, inviteBase, inviteUrl,
  parseProspectList, type Prospect, type ProspectNetwork, type ProspectSource, type Templates,
} from '../lib/prospects';
import type { ProspectFilter, ProspectServerStatus } from '../lib/backend/prospectTypes';
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Outgoing = { p: Prospect; subject: string; body: string };
type SendTotals = { sent: number; skipped: number; failed: number; warning?: string };

// Emails go out from Zoho 5 at a time with a short pause, and stop at the daily
// limit or at the first problem (wrong password, Zoho slowing us down).
export async function sendInGroups(list: Outgoing[], followUp: boolean, onProgress: (done: number) => void): Promise<SendTotals> {
  const t: SendTotals = { sent: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < list.length; i += 5) {
    if (i) await wait(1500);
    const group = list.slice(i, i + 5);
    const r = await backend.prospects.sendEmails(group.map((x) => ({ id: x.p.id, subject: x.subject, body: x.body })), followUp, inviteBase());
    if (!r.ok) { t.warning = r.error; break; }
    t.sent += r.sent.length; t.skipped += r.skipped.length; t.failed += r.failed.length;
    onProgress(Math.min(list.length, i + group.length));
    if (r.warning) { t.warning = r.warning; break; }
    if (r.remaining <= 0 && i + 5 < list.length) { t.warning = 'Se llegó al límite de correos de hoy. Sigue mañana con los que faltan.'; break; }
  }
  return t;
}

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

export function MessageDialog({ prospect, server, emailsToday, onClose, onChanged }: {
  prospect: Prospect; server?: ProspectServerStatus; emailsToday?: number; onClose: () => void; onChanged: (text: string) => void;
}) {
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
  const [linkCopied, setLinkCopied] = useState(false);
  const blocked = prospect.status === 'no_contactar';
  const network = NETWORKS[prospect.network];
  const zohoLeft = server?.email === 'ok' ? Math.max(0, server.emailLimit - (emailsToday ?? 0)) : 0;
  // Zoho sends the first email, and the follow-up of whoever we first wrote by email.
  const zohoKind = !!prospect.email && server?.email === 'ok' && (kind === 'email' ? prospect.status === 'nuevo' : kind === 'followUp' && prospect.channel === 'email');

  const copyLink = async () => {
    if (!prospect.inviteCode) return;
    try { await navigator.clipboard.writeText(inviteUrl(prospect.inviteCode)); setLinkCopied(true); } catch { setError('No se pudo copiar el link.'); }
  };
  const sendZoho = async () => {
    setBusy(true); setError('');
    const followUp = kind === 'followUp';
    const r = await sendInGroups([{ p: prospect, subject: followUp ? `Re: ${subject}` : subject, body: text }], followUp, () => {});
    setBusy(false);
    if (r.sent) { onChanged(`Correo enviado a @${prospect.handle} desde Zoho.`); return; }
    setError(r.warning ?? (r.skipped ? 'No se envió: ya estaba contactado o no tiene correo.' : 'Zoho no aceptó este correo. Revisa la dirección.'));
  };

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
        {prospect.openedAt && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">Abrió su link</span>}
        {prospect.interestedAt && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900">Quiere participar</span>}
        {prospect.inviteCode && !blocked && <button type="button" onClick={() => void copyLink()} className="ml-auto min-h-11 rounded-lg px-2 text-sm font-medium text-pink-800 underline underline-offset-4">
          <i aria-hidden="true" className={`fas ${linkCopied ? 'fa-check' : 'fa-link'} mr-1`} />{linkCopied ? 'Link copiado' : 'Copiar su link'}</button>}
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
          <p className="mt-1 text-xs text-gray-500">{kind === 'dm'
            ? 'Sin enlaces en el primer DM: cuando responda, mándale su link con "Copiar su link". Así es menos probable que lo tomen como spam.'
            : 'Lleva su link personal: así vemos si lo abre y si quiere participar, sin preguntarle.'}</p>
        </div>
        {zohoKind && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-emerald-900">Envíalo desde <b>{server?.emailFrom}</b>. {zohoLeft ? `Hoy quedan ${zohoLeft} de ${server?.emailLimit}.` : 'Ya se llegó al límite de hoy.'}</p>
          <button type="button" className={primary} disabled={busy || !zohoLeft} onClick={() => void sendZoho()} data-testid="zoho-send-one">
            <i aria-hidden="true" className="fas fa-paper-plane mr-2" />{busy ? 'Enviando…' : 'Enviar ahora'}</button>
        </div>}
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
      <p className="text-gray-600">Se completan solas con los datos de cada creador: <code className="rounded bg-gray-100 px-1">{'{nombre}'}</code> (su primer nombre), <code className="rounded bg-gray-100 px-1">{'{usuario}'}</code>, <code className="rounded bg-gray-100 px-1">{'{pais}'}</code>, <code className="rounded bg-gray-100 px-1">{'{categoria}'}</code>, <code className="rounded bg-gray-100 px-1">{'{link}'}</code> (su link personal de invitación) y <code className="rounded bg-gray-100 px-1">{'{baja}'}</code> (el enlace para no recibir más). Se guardan en este navegador.</p>
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

/* ---------- Batches ---------- */

type BatchKind = 'first' | 'followUp';
const SIZES = [10, 25, 50];

function BatchSetup({ kind, setKind, size, setSize, sizes, children }: {
  kind: BatchKind; setKind: (k: BatchKind) => void; size: number; setSize: (n: number) => void; sizes: number[]; children?: React.ReactNode;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <div><label className={label} htmlFor="batch-kind">Qué mensaje</label>
      <select id="batch-kind" className={field} value={kind} onChange={(e) => setKind(e.target.value as BatchKind)}>
        <option value="first">Primer mensaje (por contactar)</option>
        <option value="followUp">Seguimiento (contactados hace 5+ días)</option>
      </select></div>
    <div><label className={label} htmlFor="batch-size">Cuántos</label>
      <select id="batch-size" className={field} value={size} onChange={(e) => setSize(Number(e.target.value))}>
        {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
      </select></div>
    {children}
  </div>;
}

const batchFilter = (filter: ProspectFilter, kind: BatchKind): ProspectFilter => ({ ...filter, status: kind === 'first' ? 'nuevo' : 'follow_up', sort: 'score' });

// DMs can't be sent automatically (no official API for first messages), so the batch
// takes the admin through each creator: copy and open the profile, paste, mark it.
export function BatchDmDialog({ filter, sentToday, safeDaily, onClose, onDone }: {
  filter: ProspectFilter; sentToday: number; safeDaily: number; onClose: () => void; onDone: (text: string) => void;
}) {
  const [network, setNetwork] = useState<ProspectNetwork>(filter.network && filter.network !== 'youtube' ? filter.network : 'instagram');
  const [kind, setKind] = useState<BatchKind>('first');
  const [size, setSize] = useState(25);
  const [queue, setQueue] = useState<Prospect[] | null>(null);
  const [at, setAt] = useState(0);
  const [text, setText] = useState('');
  const [opened, setOpened] = useState(false);
  const [sent, setSent] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const templates = useMemo(loadTemplates, []);
  const current = queue?.[at];

  useEffect(() => {
    if (current) setText(fillTemplate(kind === 'first' ? templates.dm : templates.followUp, current));
    setOpened(false);
  }, [current, kind, templates]);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const rows = (await backend.prospects.exportRows({ ...batchFilter(filter, kind), network })).slice(0, size);
      if (!rows.length) setError(kind === 'first' ? `No hay creadores de ${NETWORKS[network].label} por contactar con estos filtros.` : 'No hay seguimientos pendientes con estos filtros.');
      else { setQueue(rows); setAt(0); }
    } catch { setError('No pudimos preparar el lote.'); }
    setBusy(false);
  };
  const copyAndOpen = async () => {
    if (!current) return;
    try { await navigator.clipboard.writeText(text); } catch { setError('No se pudo copiar. Selecciona el texto y cópialo a mano.'); }
    window.open(NETWORKS[current.network].url(current.handle), '_blank', 'noopener,noreferrer');
    setOpened(true);
  };
  const next = () => setAt((i) => i + 1);
  const mark = async (patch: Parameters<typeof backend.prospects.update>[1], counted: boolean) => {
    if (!current) return;
    setBusy(true); setError('');
    const r = await backend.prospects.update(current.id, patch);
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return; }
    if (counted) setSent((n) => n + 1); else setSkipped((n) => n + 1);
    next();
  };
  const finished = queue && at >= queue.length;
  const close = () => (sent || skipped ? onDone(`Lote terminado: ${sent} ${kind === 'first' ? 'mensajes enviados' : 'seguimientos enviados'}${skipped ? `, ${skipped} descartados o saltados` : ''}.`) : onClose());
  const over = kind === 'first' && sentToday + sent >= safeDaily;

  if (!queue) return <AdminDialog title="Lote de DMs" onClose={onClose} busy={busy}>
    <div className="space-y-4 text-sm">
      <p className="text-gray-600">Instagram y TikTok no permiten enviar DMs automáticos: un bot nos cerraría la cuenta. Aquí te pasamos los creadores uno tras otro con su mensaje listo: <b>copias y abres su perfil</b> con un toque, pegas en su chat, y con otro toque pasas al siguiente.</p>
      <BatchSetup kind={kind} setKind={setKind} size={size} setSize={setSize} sizes={SIZES}>
        <div className="sm:col-span-2"><label className={label} htmlFor="batch-network">Red</label>
          <select id="batch-network" className={field} value={network} onChange={(e) => setNetwork(e.target.value as ProspectNetwork)}>
            {(['instagram', 'tiktok', 'facebook'] as ProspectNetwork[]).map((n) => <option key={n} value={n}>{NETWORKS[n].label}</option>)}
          </select></div>
      </BatchSetup>
      <p className="text-xs text-gray-500">Usa los filtros de la lista (país, tamaño, búsqueda) y empieza por el mejor puntaje. Hoy van {sentToday} primeros mensajes; más de {safeDaily} al día aumenta el riesgo de bloqueo.</p>
      {error && <p role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-900">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancelar</button>
        <button type="button" className={primary} disabled={busy} onClick={() => void start()}>{busy ? 'Preparando…' : 'Empezar el lote'}</button></div>
    </div>
  </AdminDialog>;

  return <AdminDialog title={finished ? 'Lote terminado' : `Lote de DMs · ${at + 1} de ${queue.length}`} onClose={close} busy={busy} wide>
    <div className="space-y-4 text-sm">
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={at} aria-label="Avance del lote">
        <div className="h-full rounded-full bg-gray-900 transition-[width] duration-300" style={{ width: `${(at / queue.length) * 100}%` }} />
      </div>
      {finished || !current ? <div className="text-center py-6">
        <p className="text-4xl" aria-hidden="true">🎉</p>
        <p className="mt-2 text-lg font-bold">{sent} {kind === 'first' ? 'mensajes enviados' : 'seguimientos enviados'}</p>
        {skipped > 0 && <p className="text-gray-600">{skipped} descartados o saltados</p>}
        <button type="button" className={`${primary} mt-4`} onClick={close}>Listo</button>
      </div> : <>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 p-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-gray-900 truncate">@{current.handle}</p>
            <p className="text-gray-600">{current.displayName ? `${current.displayName} · ` : ''}{flag(current.country)} {countryLabel(current.country)}{current.category ? ` · ${current.category}` : ''}</p>
          </div>
          <p className="shrink-0 text-right"><span className="block font-bold tabular-nums">{compact(current.followers)}</span><span className="text-xs text-gray-500">seguidores</span></p>
        </div>
        {current.notes && <p className="text-xs text-gray-700 italic">“{current.notes}”</p>}
        <div><label className={label} htmlFor="batch-text">Mensaje</label>
          <textarea id="batch-text" rows={7} className={field} value={text} onChange={(e) => setText(e.target.value)} /></div>
        {over && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">Ya van {sentToday + sent} primeros mensajes hoy. Te recomiendo parar y seguir mañana para que no bloqueen la cuenta.</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">{error}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={`${opened ? secondary : primary} w-full`} onClick={() => void copyAndOpen()}>
            <i aria-hidden="true" className={`${NETWORKS[current.network].icon} mr-2`} />{opened ? 'Copiar y abrir otra vez' : '1. Copiar y abrir su perfil'}</button>
          <button type="button" className={`${opened ? primary : secondary} w-full`} disabled={busy}
            onClick={() => void mark(kind === 'first' ? { status: 'contactado', channel: 'dm' } : { followUps: current.followUps + 1 }, true)}>
            2. Enviado, siguiente <i aria-hidden="true" className="fas fa-arrow-right ml-2" /></button>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
          <span className="flex gap-2">
            <button type="button" className={secondary} disabled={busy} onClick={() => { setSkipped((n) => n + 1); next(); }}>Saltar</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => void mark({ status: 'descartado' }, false)}>No encaja</button>
          </span>
          <button type="button" className="min-h-11 px-3 text-gray-600 underline underline-offset-4" onClick={close}>Terminar aquí</button>
        </div>
      </>}
    </div>
  </AdminDialog>;
}

// Emails go out in batches: straight from the team's Zoho mailbox (with a safe daily
// limit, set up in Vercel) or as a file for a sending tool like Instantly.
export function BatchEmailDialog({ filter, server, emailsToday, onClose, onDone }: {
  filter: ProspectFilter; server: ProspectServerStatus; emailsToday: number; onClose: () => void; onDone: (text: string) => void;
}) {
  const zoho = server.email === 'ok';
  const left = zoho ? Math.max(0, server.emailLimit - emailsToday) : 0;
  const sizes = zoho ? [5, 10, 25, 50].filter((n) => n < left).concat(left ? [left] : []) : [25, 50, 100, 250, 500];
  const [kind, setKind] = useState<BatchKind>('first');
  const [size, setSize] = useState(zoho ? Math.min(10, left || 10) : 50);
  const [batch, setBatch] = useState<Prospect[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const pick = async () => {
    const rows = (await backend.prospects.exportRows({ ...batchFilter(filter, kind), withEmail: true }))
      // A follow-up email only goes to who we first wrote by email.
      .filter((p) => kind === 'first' || p.channel === 'email').slice(0, size);
    if (!rows.length) setError(kind === 'first' ? 'No hay creadores por contactar con correo público con estos filtros.' : 'No hay seguimientos de correo pendientes con estos filtros.');
    return rows;
  };
  const prepare = async () => {
    setBusy(true); setError('');
    try {
      const rows = await pick();
      if (rows.length) {
        setBatch(rows);
        download(`lote-correos-${kind === 'first' ? 'primer-mensaje' : 'seguimiento'}-${new Date().toISOString().slice(0, 10)}.csv`, emailBatchCsv(rows, loadTemplates(), kind === 'followUp'));
      }
    } catch { setError('No pudimos preparar el lote.'); }
    setBusy(false);
  };
  const sendNow = async () => {
    setBusy(true); setError('');
    try {
      const rows = await pick();
      if (!rows.length) { setBusy(false); return; }
      const t = loadTemplates();
      const followUp = kind === 'followUp';
      setTotal(rows.length);
      setProgress(0);
      const r = await sendInGroups(rows.map((p) => ({
        p, subject: followUp ? `Re: ${fillTemplate(t.emailSubject, p)}` : fillTemplate(t.emailSubject, p), body: fillTemplate(followUp ? t.followUp : t.email, p),
      })), followUp, setProgress);
      setBusy(false); setProgress(null);
      if (!r.sent && r.warning) { setError(r.warning); return; }
      onDone([`Salieron ${r.sent} ${r.sent === 1 ? 'correo' : 'correos'} desde Zoho`, r.skipped ? `${r.skipped} se saltaron` : '', r.failed ? `${r.failed} rebotaron` : ''].filter(Boolean).join(', ') + '.' + (r.warning ? ` ${r.warning}` : ''));
    } catch { setBusy(false); setProgress(null); setError('No pudimos terminar el envío. Lo que salió quedó marcado.'); }
  };
  const markAll = async () => {
    if (!batch) return;
    setBusy(true); setError('');
    const r = kind === 'first'
      ? await backend.prospects.updateMany(batch.map((p) => p.id), { status: 'contactado', channel: 'email' })
      : await Promise.all(batch.map((p) => backend.prospects.update(p.id, { followUps: p.followUps + 1 }))).then((all) => all.find((x) => !x.ok) ?? { ok: true });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); return; }
    onDone(`${batch.length} ${batch.length === 1 ? 'creador quedó' : 'creadores quedaron'} como ${kind === 'first' ? 'contactados por correo' : 'con seguimiento enviado'}.`);
  };

  if (progress !== null) return <AdminDialog title="Enviando correos" onClose={() => {}} busy>
    <div className="space-y-3 text-sm" role="status">
      <p>Enviando desde <b>{server.emailFrom}</b>… {progress} de {total}</p>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-gray-900 transition-[width] duration-300" style={{ width: `${(progress / Math.max(1, total)) * 100}%` }} /></div>
      <p className="text-xs text-gray-500">No cierres esta ventana. Salen de 5 en 5 con una pausa corta.</p>
    </div>
  </AdminDialog>;

  return <AdminDialog title="Lote de correos" onClose={onClose} busy={busy}>
    <div className="space-y-4 text-sm">
      {!batch ? <>
        {zoho
          ? <p className="text-gray-600">Salen directo desde <b>{server.emailFrom}</b>, uno por uno, con el nombre, el país y el <b>link personal</b> de cada creador, y el enlace para darse de baja. Se marcan solos como contactados.</p>
          : <p className="text-gray-600">Descarga un archivo con cada correo ya escrito (asunto y mensaje con su nombre, país y link personal) para subirlo a <b>Instantly</b> o <b>Smartlead</b>. Para enviarlos desde aquí, conecta Zoho en Vercel (ZOHO_SMTP_USER y ZOHO_SMTP_PASSWORD).</p>}
        <BatchSetup kind={kind} setKind={setKind} size={size} setSize={setSize} sizes={sizes.length ? sizes : [0]} />
        {zoho && <div className={`rounded-lg p-3 ${left ? 'bg-gray-50 text-gray-700' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
          {left ? <>Hoy van <b>{emailsToday}</b> de <b>{server.emailLimit}</b> correos. Un buzón nuevo que escribe a desconocidos se marca rápido como spam: sube el límite poco a poco.</> : <>Ya salieron los {server.emailLimit} correos de hoy. Sigue mañana.</>}
        </div>}
        <p className="text-xs text-gray-500">Solo creadores con correo público, con los filtros de la lista y por mejor puntaje. Nunca con Resend.</p>
        {error && <p role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-900">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose}>Cancelar</button>
          {zoho && <button type="button" className="min-h-11 px-2 text-gray-600 underline underline-offset-4 disabled:opacity-50" disabled={busy} onClick={() => void prepare()}>Solo descargar el archivo</button>}
          {zoho
            ? <button type="button" className={primary} disabled={busy || !left || !size} onClick={() => void sendNow()} data-testid="zoho-send-batch"><i aria-hidden="true" className="fas fa-paper-plane mr-2" />{busy ? 'Preparando…' : `Enviar ${size} desde Zoho`}</button>
            : <button type="button" className={primary} disabled={busy} onClick={() => void prepare()}>{busy ? 'Preparando…' : 'Descargar el lote'}</button>}
        </div>
      </> : <>
        <p className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-900">Se descargó el archivo con <b>{batch.length} correos</b>.</p>
        <ol className="list-decimal pl-5 space-y-1 text-gray-700">
          <li>En Instantly: <b>Leads → Import → CSV</b> y sube el archivo.</li>
          <li>En la secuencia pon <code className="rounded bg-gray-100 px-1">{'{{subject}}'}</code> como asunto y <code className="rounded bg-gray-100 px-1">{'{{body}}'}</code> como mensaje.</li>
          <li>Cuando la campaña quede programada, marca el lote aquí abajo.</li>
        </ol>
        {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Lo marco después</button>
          <button type="button" className={primary} disabled={busy} onClick={() => void markAll()}>{busy ? 'Guardando…' : `Marcar los ${batch.length} como ${kind === 'first' ? 'contactados' : 'con seguimiento'}`}</button>
        </div>
      </>}
    </div>
  </AdminDialog>;
}
