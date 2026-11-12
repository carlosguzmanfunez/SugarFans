// The 12 AM / 12 PM "Mano derecha" report as an email (api/usage.ts?report=1).
// Plain inline-styled tables so it reads well in Gmail, Zoho and phone apps.
import type { MonitorMoney, MonitorProblem } from './adminMonitor.js';
import { sortProblems, usd } from './adminMonitor.js';

export interface MonitorReportRow {
  id: string;
  kind: 'midday' | 'midnight';
  title: string;
  body: string;
  window_from: string;
  window_to: string;
  data: { dinero: MonitorMoney; mes?: MonitorMoney; problemas: MonitorProblem[] };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Same colors as the admin panel (validated categorical slots 1-3 + status colors).
export const SPLIT_COLORS = { creadores: '#2a78d6', paypal: '#eb6834', fr: '#1baf7a' } as const;
const STATUS = {
  alta: { dot: '#d03b3b', bg: '#fdecec', ink: '#8f1f1f', label: 'Urgente' },
  media: { dot: '#fab219', bg: '#fff6e0', ink: '#7a5200', label: 'Revisar' },
  baja: { dot: '#9a9a96', bg: '#f1f1ef', ink: '#52514e', label: 'Info' },
} as const;

export const hnTime = (iso: string) =>
  new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

// How the money that came in was split (creators / PayPal / Fans Reserve), in %.
export const moneySplit = (m: MonitorMoney) => {
  const parts = [
    { key: 'creadores' as const, label: 'Creadores', value: Math.max(0, m.creadores) },
    { key: 'paypal' as const, label: 'PayPal', value: Math.max(0, m.comision_paypal) },
    { key: 'fr' as const, label: 'Fans Reserve', value: Math.max(0, m.fr_con_isv) },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  return { total, parts: parts.map((p) => ({ ...p, pct: total > 0 ? (p.value / total) * 100 : 0 })) };
};

export const overallStatus = (list: MonitorProblem[]) => {
  const urgent = list.filter((p) => p.nivel === 'alta').length;
  const review = list.filter((p) => p.nivel === 'media').length;
  if (urgent) return { tone: 'alta' as const, text: `${urgent} ${urgent === 1 ? 'asunto urgente' : 'asuntos urgentes'}` };
  if (review) return { tone: 'media' as const, text: `${review} ${review === 1 ? 'cosa por revisar' : 'cosas por revisar'}` };
  return { tone: 'ok' as const, text: 'Todo en orden' };
};

const tile = (label: string, value: string, hint = '') =>
  `<td width="50%" valign="top" style="padding:6px"><div style="background:#f6f6f4;border-radius:12px;padding:12px 14px;min-height:62px">
<div style="font-size:12px;color:#52514e">${esc(label)}</div>
<div style="font-size:20px;font-weight:bold;color:#0b0b0b;margin-top:2px">${esc(value)}</div>
${hint ? `<div style="font-size:12px;color:#6b6a66;margin-top:2px">${esc(hint)}</div>` : ''}</div></td>`;

export function monitorReportEmail(r: MonitorReportRow, panelUrl = 'https://fansreserve.com/admin?section=monitor') {
  const m = r.data.dinero;
  const month = r.data.mes;
  const problems = sortProblems(r.data.problemas ?? []);
  const status = overallStatus(problems);
  const statusStyle = status.tone === 'ok'
    ? { bg: '#e7f6e7', ink: '#0b6b0b', icon: '✓' }
    : status.tone === 'alta' ? { bg: STATUS.alta.bg, ink: STATUS.alta.ink, icon: '!' } : { bg: STATUS.media.bg, ink: STATUS.media.ink, icon: '•' };
  const split = moneySplit(m);
  const icon = r.kind === 'midday' ? '☀️' : '🌙';

  const bar = split.total > 0
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:2px 0;margin-top:14px"><tr>${split.parts
        .filter((p) => p.pct > 0)
        .map((p) => `<td width="${p.pct.toFixed(2)}%" style="height:12px;background:${SPLIT_COLORS[p.key]};border-radius:4px;font-size:0;line-height:0">&nbsp;</td>`)
        .join('')}</tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px"><tr>${split.parts
        .map((p) => `<td style="font-size:12px;color:#52514e;padding-right:8px"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${SPLIT_COLORS[p.key]};margin-right:4px"></span>${esc(p.label)} <b style="color:#0b0b0b">${esc(usd(p.value))}</b></td>`)
        .join('')}</tr></table>`
    : '<p style="font-size:13px;color:#6b6a66;margin:12px 0 0">Sin cobros en este periodo.</p>';

  const attention = problems.length === 0
    ? '<p style="font-size:14px;color:#0b6b0b;margin:0">Sin disputas, retiros fallidos, incidentes ni errores del servidor.</p>'
    : problems.map((p) => {
        const s = STATUS[p.nivel];
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:8px"><tr>
<td width="72" valign="top"><span style="display:inline-block;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:999px;background:${s.bg};color:${s.ink}">${s.label}</span></td>
<td style="font-size:14px;color:#0b0b0b">${esc(p.titulo)}${p.donde ? `<div style="font-size:12px;color:#6b6a66">${esc(p.donde)}</div>` : ''}${p.detalle ? `<div style="font-size:12px;color:#6b6a66">${esc(p.detalle)}</div>` : ''}</td></tr></table>`;
      }).join('');

  const types = [
    ['Reserve', m.por_tipo.reserve], ['Suscripciones', m.por_tipo.suscripciones], ['Créditos comprados', m.por_tipo.creditos],
    ['Propinas', m.por_tipo.propinas], ['Regalos (con Créditos)', m.por_tipo.regalos],
  ] as const;
  const typeRows = types.map(([label, v]) => `<tr><td style="font-size:14px;color:#52514e;padding:6px 0;border-top:1px solid #eeeeec">${label}</td>
<td style="font-size:14px;color:#6b6a66;padding:6px 0;border-top:1px solid #eeeeec;text-align:center">${v.n}</td>
<td style="font-size:14px;color:#0b0b0b;font-weight:bold;padding:6px 0;border-top:1px solid #eeeeec;text-align:right">${esc(usd(v.monto))}</td></tr>`).join('');

  const section = (title: string, inner: string) =>
    `<tr><td style="padding:18px 22px 4px"><div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#6b6a66;margin-bottom:10px">${title}</div>${inner}</td></tr>`;

  const html = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#efefec;font-family:Arial,Helvetica,sans-serif;color:#0b0b0b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="background:#111111;padding:22px 22px 20px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#bdbdb8">Fans Reserve · Mano derecha</div>
<div style="font-size:22px;font-weight:bold;color:#ffffff;margin-top:6px">${icon} ${esc(r.title.split(' · ')[0])}</div>
<div style="font-size:13px;color:#bdbdb8;margin-top:4px">${esc(hnTime(r.window_from))} → ${esc(hnTime(r.window_to))} · hora Honduras</div>
</td></tr>
<tr><td style="padding:18px 22px 0"><div style="background:${statusStyle.bg};color:${statusStyle.ink};border-radius:12px;padding:10px 14px;font-size:14px;font-weight:bold">${statusStyle.icon} ${esc(status.text)}</div></td></tr>
${section('Ganancia de Fans Reserve', `<div style="font-size:32px;font-weight:bold;color:#0b0b0b">${esc(usd(m.fr_con_isv))} <span style="font-size:14px;font-weight:normal;color:#52514e">con ISV</span></div>
<div style="font-size:14px;color:#52514e;margin-top:2px">${esc(usd(m.fr_sin_isv))} sin ISV · ISV 15%: ${esc(usd(m.isv))}</div>
<div style="font-size:13px;color:#52514e;margin-top:12px">Así se repartieron ${esc(usd(m.cobrado))} cobrados:</div>${bar}`)}
${section('Dinero', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -6px"><tr>${tile('Cobrado', usd(m.cobrado), `${m.pagos} pagos · ${m.fans_que_pagaron} fans`)}${tile('Para creadores', usd(m.creadores))}</tr>
<tr>${tile('Comisión PayPal', usd(m.comision_paypal))}${tile('Retiros pagados', usd(m.retiros_pagados.monto), `${m.retiros_pagados.n} retiros`)}</tr>
<tr>${tile('Devuelto', usd(m.devuelto))}${tile('En disputa', usd(m.en_disputa))}</tr></table>`)}
${section(`Necesita atención (${problems.length})`, attention)}
${section('Por tipo', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="font-size:12px;color:#6b6a66;padding-bottom:4px">Tipo</td><td style="font-size:12px;color:#6b6a66;text-align:center">Pagos</td><td style="font-size:12px;color:#6b6a66;text-align:right">Monto</td></tr>${typeRows}</table>`)}
${section('Movimiento', `<div style="font-size:14px;line-height:1.7;color:#0b0b0b">👤 ${m.personas_nuevas} personas nuevas · ${m.creadores_verificados} creadores verificados<br>📅 ${m.reservas_nuevas} Reserve nuevas · ${m.reservas_pagadas} pagadas<br>⚠️ ${m.errores_pagina} errores registrados en la página</div>`)}
${month ? section('Mes hasta ahora', `<div style="font-size:14px;line-height:1.7">Cobrado <b>${esc(usd(month.cobrado))}</b> · Fans Reserve <b>${esc(usd(month.fr_con_isv))}</b> con ISV · ${esc(usd(month.fr_sin_isv))} sin ISV</div>`) : ''}
<tr><td align="center" style="padding:22px"><a href="${esc(panelUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:999px">Abrir Mano derecha</a></td></tr>
<tr><td style="padding:0 22px 22px;font-size:12px;color:#6b6a66;text-align:center">Este reporte solo lee datos: ningún dinero se movió por él. "Con ISV" incluye el 15% que se declara sobre la parte de Fans Reserve; la parte de los creadores no paga ISV.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject: `${r.kind === 'midday' ? '☀️' : '🌙'} ${r.title} · ${status.text}`, html, text: r.body };
}
