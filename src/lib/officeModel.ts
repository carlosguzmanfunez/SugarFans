// Oficina de la Mano derecha (/oficina): convierte lo que devuelve monitor_live en la
// oficina pixel. Cada área tiene su agente, sus alertas (códigos de manual-operacion.md,
// sección 4), su ficha y una sola decisión para Carlos.
// Código puro: sin red ni DOM. Lo usan oficina.html y e2e/office-model.mjs.
// Si cambia una ficha del manual, se cambia aquí en el mismo PR.

export type Nivel = 'alta' | 'media' | 'baja';
export type Estado = 'ok' | 'warn' | 'bad' | 'idle';
export type AgentId = 'mano' | 'dinero' | 'disputas' | 'retiros' | 'personas' | 'reserve' | 'contenido' | 'sistema' | 'legal';
export type Grupo = 'tu' | 'cola' | 'proceso' | 'info';

export interface Money {
  cobrado?: number; comision_paypal?: number; creadores?: number; fr_con_isv?: number; isv?: number; fr_sin_isv?: number;
  pagos?: number; fans_que_pagaron?: number; devuelto?: number; en_disputa?: number;
  retiros_pagados?: { n?: number; monto?: number };
  personas_nuevas?: number; creadores_verificados?: number; reservas_nuevas?: number; reservas_pagadas?: number; errores_pagina?: number;
}
export interface Problema { code: string; nivel: Nivel; n?: number; titulo: string; detalle?: string; donde?: string }
export interface MonitorLive {
  ahora: {
    at: string; dia?: string; ultima_hora?: Money; hoy?: Money; mes?: Money; problemas?: Problema[];
    pendiente?: { retiros_enviandose?: number; reserve_por_responder?: number; reserve_confirmadas_proximas?: number };
  };
  horas?: { at: string; cobrado: number | null }[];
  dias?: { day: string; closed: boolean; dinero?: Money }[];
  reportes?: { kind: string; day: string; title: string; body: string; created_at: string; emailed_at: string | null }[];
  ultima_revision?: string | null;
}

export interface Caso {
  id: string; code: string; nivel: Nivel; agent: AgentId; grupo: Grupo;
  titulo: string; detalle?: string; donde?: string; regla: string; hago: string; pregunta?: string;
}
export interface Serie { titulo: string; dias: string[]; valores: (number | null)[]; dinero: boolean }
export interface Agente {
  id: AgentId; area: string; nombre: string; rasgo: string; estado: Estado; dice: string; corto: string;
  vigila: { code: string; n: number; nivel: Nivel }[]; numeros: [string, string][]; serie: Serie | null;
  casos: Caso[]; nota: string;
}
export interface Oficina {
  at: string; foto: { at: string | null; minutos: number | null; vieja: boolean }; proximoReporte: string;
  estado: Estado; agentes: Agente[]; casos: Caso[]; decision: Caso | null; revisiones24h: number;
  calendario: { fase: 0 | 1 | 2; texto: string; corto: string };
}

// Ficha de cada alerta del monitor (manual 4): letra del caso (como en el chat de la
// Mano derecha), quién la atiende, qué hace y la pregunta para Carlos si necesita su sí.
interface Ficha { letra: string; agent: AgentId; regla: string; hago: string; pregunta?: string }
export const FICHAS: Record<string, Ficha> = {
  disputas: { letra: 'D', agent: 'disputas', regla: 'Manual 4 · disputas (contrato 6.2.3 y 6.2.4)',
    hago: 'Identifico la venta (fan, creador, monto, fecha y referencia de PayPal). Si es una Reserve, armo el expediente en inglés y te preparo qué pasó, la evidencia y el plazo de PayPal.',
    pregunta: '¿Respondemos la disputa con el expediente? ¿Quién paga el cargo: Fans Reserve o el creador?' },
  reserve_disputa: { letra: 'D', agent: 'disputas', regla: 'Manual 4 · Reserve en disputa',
    hago: 'Reviso el recibo de asistencia (quién entró, cuánto duró, ciudad aproximada) y lo comparo con la regla: si el fan no llegó, el creador cobra; si el creador no llegó, 100% al fan.',
    pregunta: '¿Aplicamos la resolución que te propongo, con esta evidencia?' },
  incidentes: { letra: 'A', agent: 'disputas', regla: 'Manual 4 · incidentes de finanzas',
    hago: 'Leo el detalle, busco la referencia en PayPal y en paypal_payout_events y te explico qué pasó. Nunca reenvío un retiro “por si acaso”: un envío incierto no se repite.',
    pregunta: '¿Seguimos la acción del procedimiento que te traigo con el detalle?' },
  retiros_fallidos: { letra: 'P', agent: 'retiros', regla: 'Manual 4 · retiro fallido',
    hago: 'Leo el error, reviso que el saldo volvió al creador y preparo el mensaje para pedirle su correo de PayPal correcto.',
    pregunta: '¿Le avisamos al creador? Cambiar la cuenta de retiro deja 48 h de espera.' },
  retiros_atascados: { letra: 'P', agent: 'retiros', regla: 'Manual 4 · retiro enviándose',
    hago: 'Espero el aviso de PayPal, que puede tardar. Si pasa de 24 h, reviso el lote en PayPal y abro un expediente. No se reenvía.' },
  tareas_fallidas: { letra: 'E', agent: 'sistema', regla: 'Manual 4 · tareas automáticas',
    hago: 'Leo el error en cron.job_run_details, busco la función en supabase/migrations y abro un PR en borrador con el arreglo y su prueba.',
    pregunta: '¿Me das el “fusiónalo” del PR con el arreglo (y permiso para el SQL, si trae)?' },
  devoluciones: { letra: 'F', agent: 'retiros', regla: 'Manual 4 y 5 · devoluciones',
    hago: 'Reviso cada solicitud contra la regla: al método original, menos la comisión de PayPal y, con 24 h o más, menos el 10% de servicio ($25 → $20.85).',
    pregunta: '¿Apruebo las devoluciones en dinero que te preparé?' },
  pagos_fallidos: { letra: 'A', agent: 'dinero', regla: 'Manual 4 · pagos fallidos',
    hago: 'Busco el error en Problemas de la página y en paypal_orders.error. Un fallo aislado suele ser del fan; si se repite el mismo motivo, reviso el código de PayPal.' },
  avisos_finanzas: { letra: 'A', agent: 'sistema', regla: 'Manual 4 · avisos de finanzas',
    hago: 'Reviso finance_alert_queue.last_error: casi siempre es la llave de Resend o su límite de 100 correos al día.' },
  correos: { letra: 'A', agent: 'sistema', regla: 'Manual 4 · correos',
    hago: 'Reviso email_outbox.last_error (llave de Resend, dominio o límite). Se reintentan solos hasta 5 veces.' },
  reporte_correo: { letra: 'A', agent: 'sistema', regla: 'Manual 4 · reporte de las 12',
    hago: 'El reporte sí está en el panel. Reviso monitor_reports.email_error y que /api/usage diga resend: OK.' },
  errores_servidor: { letra: 'E', agent: 'sistema', regla: 'Manual 4 · errores del servidor',
    hago: 'Abro Problemas de la página, agrupo por mensaje y, si se repite, abro un PR en borrador con el arreglo.' },
  errores_web: { letra: 'E', agent: 'sistema', regla: 'Manual 4 · fallos al navegar',
    hago: 'Es informativo. Miro si algún mensaje se repite mucho o afecta el pago.' },
  denuncias: { letra: 'R', agent: 'contenido', regla: 'Manual 7 · denuncias',
    hago: 'Leo la denuncia, veo el contenido y te propongo quitar, dejar o suspender, con motivo. Lo de menores o contenido ilegal va primero, el mismo día.',
    pregunta: '¿Quitamos, dejamos o suspendemos? Te traigo mi propuesta con el motivo.' },
  verificaciones: { letra: 'V', agent: 'personas', regla: 'Manual 6 · verificación con Didit',
    hago: 'Reviso documento y selfie y te propongo aprobar o rechazar, con motivo. Menor de 18 es rechazo siempre.',
    pregunta: '¿Aprobamos o rechazamos cada identidad, según mi propuesta?' },
  pagos_sin_terminar: { letra: 'A', agent: 'dinero', regla: 'Manual 4 · pagos sin terminar',
    hago: 'Es normal: la persona abrió PayPal y lo cerró. Solo preocupa si son muchos del mismo creador o del mismo fan.' },
  reserve_sin_respuesta: { letra: 'A', agent: 'reserve', regla: 'Manual 4 · Reserve sin respuesta',
    hago: 'El creador tiene que aceptar o rechazar; si no, la Reserve vence sola. Puedo recordarle al creador, con tu sí.' },
  foto_vieja: { letra: 'A', agent: 'sistema', regla: 'Mano derecha · revisión cada hora',
    hago: 'Puede que la tarea por hora esté trabada: reviso cron.job_run_details de las tareas monitor-% y te digo qué pasó.' },
};
const FICHA_OTRA: Ficha = { letra: 'A', agent: 'mano', regla: 'Manual 4', hago: 'La abro en su pantalla y te cuento qué es.' };

interface Perfil { area: string; nombre: string; rasgo: string; nota: string }
export const PERFILES: Record<AgentId, Perfil> = {
  mano: { area: 'Mano derecha', nombre: 'Sofía', rasgo: 'Organizada y tranquila. Te trae una sola decisión a la vez.', nota: 'Leo, preparo y propongo. Mover dinero, cambiar cuentas o tocar producción necesita tu sí en el chat.' },
  dinero: { area: 'Dinero', nombre: 'Beto', rasgo: 'Le gusta que todo cuadre al centavo.', nota: 'Si algo no cuadra, lo comparo con Admin › Dinero › Todos los movimientos antes de avisarte.' },
  disputas: { area: 'Disputas', nombre: 'Marisol', rasgo: 'Firme y detallista. Arma expedientes que no dejan dudas.', nota: 'No subo nada a PayPal sin tu sí.' },
  retiros: { area: 'Retiros', nombre: 'Nico', rasgo: 'Puntual. Vive pendiente del calendario.', nota: 'Un retiro incierto nunca se reenvía: primero se confirma con PayPal.' },
  personas: { area: 'Personas', nombre: 'Luna', rasgo: 'Recibe a cada creador como si fuera el primero.', nota: 'Menor de 18 es rechazo siempre. Suspender o quitar la verificación necesita tu sí.' },
  reserve: { area: 'Reserve', nombre: 'Rocío', rasgo: 'Le encanta que cada llamada salga perfecta.', nota: 'Si el creador no responde a tiempo, la Reserve vence sola.' },
  contenido: { area: 'Contenido', nombre: 'Inés', rasgo: 'Ojo fino. Lo urgente primero, siempre.', nota: 'Lo que involucre menores o contenido ilegal va primero, el mismo día.' },
  sistema: { area: 'Sistema', nombre: 'Don Chepe', rasgo: 'El vigilante de noche. Revisa todo cada hora, al minuto 5.', nota: 'Si mando avisos de más, mis tareas se pueden pausar (manual 9).' },
  legal: { area: 'Legal', nombre: 'Licda. Paz', rasgo: 'Sabe de memoria cada regla. Solo cambia algo con tu firma.', nota: 'Cambiar porcentajes, precios, reglas o textos legales necesita tu sí.' },
};
// Orden de los cubículos: fila por fila, de izquierda a derecha.
export const ORDEN: AgentId[] = ['dinero', 'mano', 'disputas', 'retiros', 'personas', 'reserve', 'contenido', 'sistema', 'legal'];
// Qué alertas mira cada agente (aunque hoy estén en cero).
const VIGILA: Partial<Record<AgentId, string[]>> = {
  dinero: ['pagos_fallidos', 'pagos_sin_terminar'],
  disputas: ['disputas', 'reserve_disputa', 'incidentes'],
  retiros: ['retiros_fallidos', 'retiros_atascados', 'devoluciones'],
  personas: ['verificaciones'],
  reserve: ['reserve_sin_respuesta'],
  contenido: ['denuncias'],
  sistema: ['tareas_fallidas', 'errores_servidor', 'correos', 'reporte_correo', 'avisos_finanzas', 'errores_web'],
};
// Reglas de dinero del manual (sección 5, versión del 7 nov 2026).
export const REGLAS: [string, string][] = [
  ['Reparto general', '70/30 del neto'], ['Creador Fundador', '72/28'], ['Nivel Diamante', '73/27'],
  ['Fan por link del creador', '75/25 (60 días)'], ['Regalos', '60/40'], ['ISV', '15% solo de la parte de Fans Reserve'],
  ['Cancelación con 24 h o más', '$25 → $20.85'], ['Retiro mínimo', '$50 ($25 Oro y Diamante)'], ['Costo del retiro', '2%, máx. USD 1'],
];

const TZ_OFFSET_H = -6; // Honduras no tiene horario de verano.
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const RANK: Record<Estado, number> = { idle: 0, ok: 1, warn: 2, bad: 3 };
const NIVEL_ORDEN: Record<Nivel, number> = { alta: 0, media: 1, baja: 2 };

const num = (n: unknown) => (typeof n === 'number' && isFinite(n) ? n : Number(n) || 0);
export const usd = (n: unknown) => { const v = num(n); return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const hn = (ms: number) => new Date(ms + TZ_OFFSET_H * 36e5);
export const horaHN = (iso: string | number | Date) => { const t = hn(new Date(iso).getTime()); const h = t.getUTCHours(); return (h % 12 || 12) + ':' + String(t.getUTCMinutes()).padStart(2, '0') + ' ' + (h < 12 ? 'a. m.' : 'p. m.'); };
export const saludo = (nowMs: number) => { const h = hn(nowMs).getUTCHours(); return h < 5 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };
const plural = (n: number, uno: string, varios: string) => n + ' ' + (n === 1 ? uno : varios);

// Cuadre del dinero: lo cobrado = comisión PayPal + creadores + Fans Reserve con ISV.
export function cuadra(m: Money | undefined): { ok: boolean; diferencia: number } {
  const d = Math.round((num(m?.cobrado) - num(m?.comision_paypal) - num(m?.creadores) - num(m?.fr_con_isv)) * 100) / 100;
  return { ok: Math.abs(d) <= 0.05, diferencia: d };
}

export function calendario(nowMs: number): Oficina['calendario'] {
  const d = hn(nowMs).getUTCDate();
  if (d >= 3 && d < 26) { const n = 26 - d; return { fase: 0, texto: `Faltan ${plural(n, 'día', 'días')} para el crédito del 26.`, corto: `crédito en ${plural(n, 'día', 'días')}` }; }
  if (d >= 26 || d === 1) return { fase: 1, texto: 'La ventana de retiros está abierta (del 26 al 1). Vigilo los envíos dos veces al día.', corto: 'ventana de retiros abierta' };
  return { fase: 2, texto: 'Hoy es día 2: confirmo que todos los retiros de la ventana quedaron pagados o tienen expediente.', corto: 'cierre del ciclo' };
}

function serie(live: MonitorLive, nowMs: number, titulo: string, pick: (m: Money) => number | undefined, dinero: boolean): Serie {
  const porDia = new Map((live.dias ?? []).map((d) => [d.day, d.dinero ?? {}]));
  const dias: string[] = []; const valores: (number | null)[] = [];
  for (let i = 6; i >= 0; i--) {
    const t = hn(nowMs - i * 864e5);
    const key = t.toISOString().slice(0, 10);
    dias.push(i === 0 ? 'Hoy' : DIA[t.getUTCDay()]);
    const m = porDia.get(key);
    valores.push(m ? num(pick(m)) : null);
  }
  return { titulo, dias, valores, dinero };
}

const FICHA_NIVEL: Record<string, Nivel> = {
  disputas: 'alta', reserve_disputa: 'alta', incidentes: 'alta', retiros_fallidos: 'alta', tareas_fallidas: 'alta',
  retiros_atascados: 'media', devoluciones: 'media', pagos_fallidos: 'media', avisos_finanzas: 'media', correos: 'media', reporte_correo: 'media',
  errores_servidor: 'media', denuncias: 'media', verificaciones: 'media', pagos_sin_terminar: 'baja', errores_web: 'baja', reserve_sin_respuesta: 'baja',
};

export function buildOffice(live: MonitorLive, nowMs: number = Date.now()): Oficina {
  const ahora = live.ahora ?? ({ at: new Date(nowMs).toISOString() } as MonitorLive['ahora']);
  const hoy = ahora.hoy ?? {}, mes = ahora.mes ?? {}, pend = ahora.pendiente ?? {};
  const fotoAt = live.ultima_revision ?? null;
  const minutos = fotoAt ? Math.max(0, Math.round((nowMs - new Date(fotoAt).getTime()) / 60000)) : null;
  const vieja = minutos !== null && minutos > 70;

  // 1) Casos: uno por alerta abierta, con su letra y número (D1, P1, F1…).
  const problemas = (ahora.problemas ?? []).slice();
  if (vieja) problemas.push({ code: 'foto_vieja', nivel: 'media', n: 1, titulo: `La última revisión automática es de hace ${minutos} min` });
  problemas.sort((a, b) => NIVEL_ORDEN[a.nivel] - NIVEL_ORDEN[b.nivel]);
  const cuenta: Record<string, number> = {};
  const casos: Caso[] = problemas.map((p) => {
    const f = FICHAS[p.code] ?? FICHA_OTRA;
    cuenta[f.letra] = (cuenta[f.letra] ?? 0) + 1;
    return { id: f.letra + cuenta[f.letra], code: p.code, nivel: p.nivel, agent: f.agent, grupo: 'info' as Grupo,
      titulo: p.titulo, detalle: p.detalle, donde: p.donde, regla: f.regla, hago: f.hago, pregunta: f.pregunta };
  });
  // 2) Una sola decisión para Carlos: la más urgente que necesita su sí. Las demás esperan en cola.
  let decision: Caso | null = null;
  for (const c of casos) {
    if (c.pregunta && c.nivel !== 'baja') { if (!decision) { decision = c; c.grupo = 'tu'; } else c.grupo = 'cola'; }
    else c.grupo = c.nivel === 'baja' ? 'info' : 'proceso';
  }

  // 3) Agentes.
  const cal = calendario(nowMs);
  const nivelDe = (code: string) => problemas.find((p) => p.code === code);
  const agentes: Agente[] = ORDEN.map((id) => {
    const per = PERFILES[id];
    const mios = casos.filter((c) => c.agent === id);
    const estado: Estado = id === 'legal' ? 'idle' : mios.some((c) => c.nivel === 'alta') ? 'bad' : mios.some((c) => c.nivel === 'media') ? 'warn' : 'ok';
    const vigila = (VIGILA[id] ?? []).map((code) => { const p = nivelDe(code); return { code, n: p ? num(p.n) || 1 : 0, nivel: (p?.nivel ?? FICHA_NIVEL[code] ?? 'media') as Nivel }; });
    return { id, area: per.area, nombre: per.nombre, rasgo: per.rasgo, nota: per.nota, estado, vigila, casos: mios, dice: '', corto: '', numeros: [], serie: null };
  });
  const byId = Object.fromEntries(agentes.map((a) => [a.id, a])) as Record<AgentId, Agente>;
  const resumen = (a: Agente, vacio: string) => a.casos.length ? a.casos.map((c) => c.titulo).join(' · ') : vacio;

  const dinero = byId.dinero, cq = cuadra(hoy);
  dinero.dice = num(hoy.cobrado) > 0
    ? `Hoy llevamos ${usd(hoy.cobrado)} cobrados y a Fans Reserve le quedan ${usd(hoy.fr_con_isv)} con ISV. ` + (cq.ok ? 'Todo cuadra al centavo.' : `Hay ${usd(Math.abs(cq.diferencia))} que no cuadran: lo comparo con Todos los movimientos.`)
    : 'Hoy todavía no hay cobros. Cuando entren, reviso que el reparto cuadre al centavo.';
  if (!cq.ok && dinero.estado === 'ok') dinero.estado = 'warn';
  dinero.corto = num(mes.cobrado) > 0 ? `${usd(mes.cobrado)} este mes` + (cq.ok ? ' · cuadra' : ' · revisar') : 'Sin cobros este mes';
  dinero.serie = serie(live, nowMs, 'Cobrado por día', (m) => m.cobrado, true);

  const disp = byId.disputas;
  disp.dice = disp.casos.length ? `Tengo ${plural(disp.casos.length, 'caso abierto', 'casos abiertos')}: ${resumen(disp, '')}. ${disp.casos[0].hago}` : 'Sin disputas ni incidentes abiertos. Si llega uno, armo el expediente y te aviso.';
  disp.corto = resumen(disp, 'Sin disputas');
  disp.numeros = [['Casos abiertos', String(disp.casos.length)], ['En disputa este mes', usd(mes.en_disputa)], ['Devuelto este mes', usd(mes.devuelto)]];
  disp.serie = serie(live, nowMs, 'En disputa por día', (m) => m.en_disputa, true);

  const ret = byId.retiros;
  ret.dice = cal.texto + (ret.casos.length ? ` Además: ${resumen(ret, '')}.` : ' No hay retiros fallidos ni atascados.');
  ret.corto = (ret.casos.length ? resumen(ret, '') + ' · ' : '') + cal.corto;
  ret.numeros = [['Retiros enviándose', String(num(pend.retiros_enviandose))], ['Retiros pagados este mes', `${num(mes.retiros_pagados?.n)} · ${usd(mes.retiros_pagados?.monto)}`], ['Devuelto este mes', usd(mes.devuelto)], ['Retiro mínimo', '$50 ($25 Oro y Diamante)'], ['Costo del retiro', '2%, máx. USD 1']];
  ret.serie = serie(live, nowMs, 'Devuelto por día', (m) => m.devuelto, true);

  const per = byId.personas;
  per.dice = per.casos.length ? `${resumen(per, '')}. ${per.casos[0].hago}` : `No hay identidades esperando. Hoy se verificaron ${plural(num(hoy.creadores_verificados), 'creador', 'creadores')}.`;
  per.corto = resumen(per, `${plural(num(hoy.personas_nuevas), 'persona nueva', 'personas nuevas')} hoy`);
  per.numeros = [['Personas nuevas hoy', String(num(hoy.personas_nuevas))], ['Creadores verificados hoy', String(num(hoy.creadores_verificados))], ['Personas nuevas este mes', String(num(mes.personas_nuevas))], ['Creadores verificados este mes', String(num(mes.creadores_verificados))]];
  per.serie = serie(live, nowMs, 'Personas nuevas por día', (m) => m.personas_nuevas, false);

  const res = byId.reserve, porResp = num(pend.reserve_por_responder), prox = num(pend.reserve_confirmadas_proximas);
  res.dice = `Hay ${plural(prox, 'Reserve confirmada', 'Reserve confirmadas')} de hoy en adelante y ${plural(porResp, 'por responder', 'por responder')}.` + (res.casos.length ? ` ${res.casos[0].titulo}.` : '');
  res.corto = porResp ? `${porResp} por responder · ${prox} próximas` : `${prox} próximas`;
  res.numeros = [['Por responder', String(porResp)], ['Confirmadas próximas', String(prox)], ['Pagadas hoy', String(num(hoy.reservas_pagadas))], ['Nuevas hoy', String(num(hoy.reservas_nuevas))], ['Pagadas este mes', String(num(mes.reservas_pagadas))]];
  res.serie = serie(live, nowMs, 'Reserve pagadas por día', (m) => m.reservas_pagadas, false);

  const con = byId.contenido;
  con.dice = con.casos.length ? `${resumen(con, '')}. ${con.casos[0].hago}` : 'Sin denuncias ni solicitudes por revisar.';
  con.corto = resumen(con, 'Sin denuncias');
  con.numeros = [['Denuncias o solicitudes por revisar', String(con.vigila.reduce((s, v) => s + v.n, 0))]];

  const sis = byId.sistema, revisiones = (live.horas ?? []).length;
  const ultimoRep = (live.reportes ?? [])[0];
  sis.dice = fotoAt
    ? (vieja ? `Mi última revisión es de hace ${minutos} min. ${FICHAS.foto_vieja.hago}` : `Hice la revisión de las ${horaHN(fotoAt)}.` + (sis.casos.length ? ` Tengo: ${resumen(sis, '')}.` : ' Todas las tareas corrieron bien.'))
    : 'Todavía no hay revisiones guardadas.';
  sis.corto = vieja ? `Revisión de hace ${minutos} min` : resumen(sis, 'Tareas al día');
  sis.numeros = [
    ['Última revisión', fotoAt ? `${horaHN(fotoAt)} (hace ${minutos} min)` : 'sin datos'],
    ['Revisiones en 24 h', `${revisiones} de 24`],
    ['Próximo reporte', hn(nowMs).getUTCHours() < 12 ? '12:00 p. m.' : '12:00 a. m.'],
    ['Último reporte', ultimoRep ? `${ultimoRep.title} · ${ultimoRep.emailed_at ? 'llegó al correo' : 'no llegó al correo'}` : 'todavía no hay'],
    ['Errores de página hoy', String(num(hoy.errores_pagina))],
  ];
  sis.serie = serie(live, nowMs, 'Errores de página por día', (m) => m.errores_pagina, false);

  const leg = byId.legal;
  leg.dice = 'Sin cambios. Cualquier cambio de precio, porcentaje o texto legal pasa primero por ti.';
  leg.corto = 'Sin cambios';
  leg.numeros = REGLAS;

  // La Mano derecha: el peor estado de la oficina y la única decisión.
  const estado = agentes.filter((a) => a.id !== 'mano').reduce<Estado>((w, a) => (RANK[a.estado] > RANK[w] ? a.estado : w), 'ok');
  const mano = byId.mano;
  mano.estado = estado;
  mano.casos = casos.filter((c) => c.agent === 'mano');
  const resto = casos.filter((c) => c !== decision && c.grupo !== 'info').length;
  mano.dice = `${saludo(nowMs)}, Carlos. ` + (decision ? `Hoy solo necesito una cosa de ti: ${decision.id}, ${decision.titulo.toLowerCase()}.` : 'Hoy no necesito ninguna decisión tuya.') +
    (resto ? ` Lo demás (${resto}) lo estamos trabajando.` : ' Todo lo demás está en orden.');
  mano.corto = decision ? `1 decisión: ${decision.id}` : 'Nada que decidir';
  mano.numeros = [['Casos abiertos', String(casos.filter((c) => c.grupo !== 'info').length)], ['Solo para que sepas', String(casos.filter((c) => c.grupo === 'info').length)], ['Revisión automática', 'cada hora, minuto 5']];

  return {
    at: ahora.at, foto: { at: fotoAt, minutos, vieja }, proximoReporte: hn(nowMs).getUTCHours() < 12 ? '12:00 p. m.' : '12:00 a. m.',
    estado, agentes, casos, decision, revisiones24h: revisiones, calendario: cal,
  };
}

export const fechaCorta = (iso: string) => { const t = hn(new Date(iso).getTime()); return t.getUTCDate() + ' ' + MES[t.getUTCMonth()]; };
