import React, { useEffect, useRef, useState } from 'react';
import type { User } from '../lib/backend/types';
import { ACTIONS, movesMoney, planAsText, sanitizePlan, type ActionType, type AssistantPlan, type ChatTurn, type Level } from '../lib/assistantPlan';
import { applyAction, askAssistant, loadCases, type CaseBundle } from '../lib/assistantData';
import { usd } from '../lib/adminMonitor';

// "Mano derecha" chat at the top of Admin > Inicio > Mano derecha. The admin asks;
// the answer comes in three steps: 1) the problems, 2) the solution per case under
// our rules, 3) an "Aplicar" button per case. Nothing runs without a click and a
// confirmation, and anything that moves money says so and asks again.
// Admin screens are only for the team: Spanish and English.
const TEXT = {
  es: {
    title: 'Pregúntale a Mano derecha', hint: 'Te dice qué pasa, cómo se resuelve según nuestras reglas y lo aplica cuando tú lo confirmas.',
    quick: ['Resuelve los casos abiertos', '¿Qué es lo más urgente hoy?', '¿Cuánto llevamos hoy?'],
    placeholder: 'Escribe tu pregunta…', send: 'Enviar', thinking: 'Revisando los casos y las reglas…',
    you: 'Tú', step1: '1. Problemas', step2: '2. Solución según nuestras reglas', step3: 'Aplicar', rule: 'Regla',
    apply: 'Aplicar', open: 'Abrir', confirm: 'Sí, aplicar', cancel: 'Cancelar', applied: 'Aplicado', applying: 'Aplicando…',
    sure: '¿Confirmas esta acción?', money: 'Esto mueve dinero', nothing: 'Sin acción por ahora',
    noCases: 'No hay casos abiertos ahora mismo.', failed: 'No pude leer: {list}. Lo demás sí.',
    safe: 'Nada se aplica sin tu clic. Lo que mueve dinero pide una confirmación extra.', clear: 'Nueva conversación',
    setup: 'El chat aún no está conectado: falta la llave de Claude en Vercel (ANTHROPIC_API_KEY). Lo demás del panel funciona igual.',
    levels: { alta: 'Urgente', media: 'Revisar', baja: 'Info' },
    actions: {
      none: 'Sin acción', open: 'Abrir su pantalla', report_resolve: 'Marcar denuncia resuelta', report_remove: 'Quitar el contenido denunciado',
      report_dismiss: 'Descartar denuncia', verification_approve: 'Aprobar identidad', verification_reject: 'Rechazar identidad',
      media_approve: 'Aprobar foto o video', media_reject: 'Rechazar foto o video', refund_approve: 'Aprobar devolución',
      refund_legal: 'Aprobar devolución legal (100%)', refund_decline: 'No aprobar devolución',
    } as Record<ActionType, string>,
  },
  en: {
    title: 'Ask Mano derecha', hint: 'It tells you what is going on, how to solve it under our rules, and applies it once you confirm.',
    quick: ['Resolve the open cases', 'What is most urgent today?', 'How much have we made today?'],
    placeholder: 'Type your question…', send: 'Send', thinking: 'Checking the cases and the rules…',
    you: 'You', step1: '1. Problems', step2: '2. Solution under our rules', step3: 'Apply', rule: 'Rule',
    apply: 'Apply', open: 'Open', confirm: 'Yes, apply', cancel: 'Cancel', applied: 'Applied', applying: 'Applying…',
    sure: 'Confirm this action?', money: 'This moves money', nothing: 'No action for now',
    noCases: 'There are no open cases right now.', failed: 'I could not read: {list}. The rest is fine.',
    safe: 'Nothing is applied without your click. Anything that moves money asks for an extra confirmation.', clear: 'New conversation',
    setup: 'The chat is not connected yet: the Claude key is missing in Vercel (ANTHROPIC_API_KEY). The rest of the panel works as usual.',
    levels: { alta: 'Urgent', media: 'Review', baja: 'Info' },
    actions: {
      none: 'No action', open: 'Open its screen', report_resolve: 'Mark report resolved', report_remove: 'Remove the reported content',
      report_dismiss: 'Dismiss report', verification_approve: 'Approve identity', verification_reject: 'Reject identity',
      media_approve: 'Approve photo or video', media_reject: 'Reject photo or video', refund_approve: 'Approve refund',
      refund_legal: 'Approve legal refund (100%)', refund_decline: 'Decline refund',
    } as Record<ActionType, string>,
  },
};

const LEVEL_PILL: Record<Level, string> = {
  alta: 'bg-red-50 text-red-700', media: 'bg-amber-100 text-amber-800', baja: 'bg-gray-100 text-gray-600',
};

type Applied = Record<string, 'done' | string>; // case id -> 'done' or the error
interface Message { id: number; role: 'user' | 'assistant'; text: string; plan?: AssistantPlan; bundle?: CaseBundle; applied?: Applied; error?: string; code?: string }

const STORE = 'fr-mano-derecha-chat';
const restore = (): Message[] => {
  try { const v = JSON.parse(sessionStorage.getItem(STORE) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

const AdminAssistantChat: React.FC<{ user: User | null; lang?: string; onOpen?: (section: string) => void }> = ({ user, lang, onOpen }) => {
  const l = lang === 'en' ? 'en' : 'es';
  const tx = TEXT[l];
  const [messages, setMessages] = useState<Message[]>(restore);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null); // `${msgId}:${caseId}`
  const [applying, setApplying] = useState<string | null>(null);
  const lastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-20))); } catch { /* full or private mode */ }
  }, [messages]);
  // A new answer scrolls into view from its first line, not from its end.
  useEffect(() => { if (messages[messages.length - 1]?.role === 'assistant') lastRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [messages.length]);

  if (!user || user.role !== 'admin') return null;

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: ChatTurn[] = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.plan ? planAsText(m.plan) : m.text }));
    const userMsg: Message = { id: Date.now(), role: 'user', text: q };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);
    try {
      const bundle = await loadCases(user);
      const res = await askAssistant(q, history, bundle, l);
      const plan = res.plan ? sanitizePlan(res.plan, bundle.cases) : undefined;
      setMessages((m) => [...m, { id: Date.now() + 1, role: 'assistant', text: plan?.reply ?? '', plan, bundle, applied: {}, error: res.error, code: res.code }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (msg: Message, caseId: string, action: ActionType, reason: string) => {
    const ref = msg.bundle?.refs[caseId];
    if (!ref) return;
    const key = `${msg.id}:${caseId}`;
    setApplying(key); setConfirming(null);
    const r = await applyAction(user, action, ref, reason).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    setMessages((all) => all.map((m) => (m.id === msg.id ? { ...m, applied: { ...m.applied, [caseId]: r.ok ? 'done' : (r.error ?? 'Error') } } : m)));
    setApplying(null);
  };

  return (
    <section className="bg-white rounded-2xl shadow-sm p-4 sm:p-6" data-testid="assistant-chat">
      <div className="mb-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 shrink-0 rounded-xl bg-gray-900 text-white flex items-center justify-center"><i aria-hidden="true" className="fas fa-comments"></i></span>
          <div>
            <h3 className="font-bold text-gray-900">{tx.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{tx.hint}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4" aria-live="polite" data-testid="assistant-messages">
        {messages.map((m, i) => m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-gray-900 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">{m.text}</p>
          </div>
        ) : (
          <div key={m.id} ref={i === messages.length - 1 ? lastRef : undefined} className="scroll-mt-4 rounded-2xl rounded-bl-md bg-gray-50 border border-gray-100 p-3 sm:p-4 text-sm text-gray-800" data-testid="assistant-answer">
            {m.error ? (
              <p role="alert" className={m.code === 'setup' ? 'text-amber-900' : 'text-red-700'}>{m.code === 'setup' ? tx.setup : m.error}</p>
            ) : (
              <>
                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                {!!m.bundle?.failed.length && <p className="mt-2 text-xs text-amber-800">{tx.failed.replace('{list}', m.bundle.failed.join(', '))}</p>}
                {m.plan && m.plan.problems.length > 0 && (
                  <div className="mt-3" data-testid="assistant-problems">
                    <p className="font-semibold text-gray-900 mb-1.5">{tx.step1}</p>
                    <ol className="space-y-1">
                      {m.plan.problems.map((p) => (
                        <li key={p.case_id} className="flex items-start gap-2">
                          <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${LEVEL_PILL[p.level]}`}>{tx.levels[p.level]}</span>
                          <span className="min-w-0 break-words"><span className="font-mono text-xs text-gray-500 mr-1">{p.case_id}</span>{p.title}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {m.plan && m.plan.solutions.length > 0 && (
                  <div className="mt-4" data-testid="assistant-solutions">
                    <p className="font-semibold text-gray-900 mb-1.5">{tx.step2}</p>
                    <ul className="space-y-2.5">
                      {m.plan.solutions.map((s) => {
                        const key = `${m.id}:${s.case_id}`;
                        const c = m.bundle?.cases.find((x) => x.id === s.case_id);
                        const ref = m.bundle?.refs[s.case_id];
                        const state = m.applied?.[s.case_id];
                        const money = movesMoney(s.action);
                        return (
                          <li key={s.case_id} className="rounded-xl bg-white border border-gray-200 p-3" data-testid="assistant-solution">
                            <p className="break-words"><span className="font-mono text-xs text-gray-500 mr-1">{s.case_id}</span>{s.solution}</p>
                            {s.rule && <p className="mt-1 text-xs text-gray-500 break-words">{tx.rule}: {s.rule}</p>}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {state === 'done' ? (
                                <span className="text-xs font-semibold text-emerald-700" data-testid="assistant-applied"><i aria-hidden="true" className="fas fa-circle-check mr-1"></i>{tx.applied} · {tx.actions[s.action]}</span>
                              ) : s.action === 'none' ? (
                                <span className="text-xs text-gray-500">{tx.nothing}</span>
                              ) : s.action === 'open' ? (
                                <button type="button" onClick={() => ref && onOpen?.(ref.section)} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-300 hover:bg-gray-50">
                                  {tx.open} <i aria-hidden="true" className="fas fa-arrow-right ml-1"></i>
                                </button>
                              ) : confirming === key ? (
                                <div className={`w-full rounded-lg p-2.5 ${money ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`} data-testid="assistant-confirm">
                                  <p className={`text-xs font-semibold ${money ? 'text-red-800' : 'text-amber-900'}`}>
                                    {money ? `${tx.money}${c?.amount != null ? `: ${usd(c.amount)}` : ''}. ` : ''}{tx.sure} {tx.actions[s.action]}
                                  </p>
                                  {s.reason && <p className="mt-1 text-xs text-gray-600 break-words">“{s.reason}”</p>}
                                  <div className="mt-2 flex gap-2">
                                    <button type="button" onClick={() => void apply(m, s.case_id, s.action, s.reason)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-semibold text-white ${money ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'}`}>{tx.confirm}</button>
                                    <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-300">{tx.cancel}</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <button type="button" disabled={applying === key || !ref || !(ACTIONS[s.action].kinds as readonly string[]).includes(ref.kind)}
                                    onClick={() => setConfirming(key)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold text-white disabled:opacity-60 ${money ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'}`}>
                                    {applying === key ? tx.applying : `${tx.apply}: ${tx.actions[s.action]}`}
                                  </button>
                                  {money && <span className="text-[11px] font-semibold text-red-700"><i aria-hidden="true" className="fas fa-sack-dollar mr-1"></i>{tx.money}</span>}
                                  {ref && <button type="button" onClick={() => onOpen?.(ref.section)} className="text-xs font-semibold text-gray-500 hover:text-gray-900">{tx.open}</button>}
                                </>
                              )}
                              {state && state !== 'done' && <span role="alert" className="text-xs text-red-700 w-full">{state}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {m.plan && !m.plan.problems.length && !m.plan.solutions.length && m.bundle && !m.bundle.cases.length && (
                  <p className="mt-2 text-xs text-gray-500">{tx.noCases}</p>
                )}
              </>
            )}
          </div>
        ))}
        {busy && <p role="status" className="text-sm text-gray-500"><i aria-hidden="true" className="fas fa-circle-notch animate-spin mr-2"></i>{tx.thinking}</p>}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {tx.quick.map((q) => (
            <button key={q} type="button" onClick={() => void send(q)} disabled={busy}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-60">{q}</button>
          ))}
        </div>
      )}

      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <label className="sr-only" htmlFor="assistant-input">{tx.title}</label>
        <textarea id="assistant-input" value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={4000}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder={tx.placeholder} className="flex-1 min-w-0 resize-none rounded-xl border border-gray-300 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" data-testid="assistant-input" />
        <button type="submit" disabled={busy || !input.trim()} className="shrink-0 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-50" data-testid="assistant-send">{tx.send}</button>
      </form>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="text-[11px] text-gray-500"><i aria-hidden="true" className="fas fa-shield-halved mr-1"></i>{tx.safe}</p>
        {messages.length > 0 && (
          <button type="button" onClick={() => setMessages([])} className="shrink-0 text-xs font-semibold text-gray-500 hover:text-gray-900" data-testid="assistant-clear">{tx.clear}</button>
        )}
      </div>
    </section>
  );
};

export default AdminAssistantChat;
