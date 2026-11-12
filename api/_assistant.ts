// "Mano derecha" chat (POST /api/usage {action: 'assistant'}): the admin asks, Claude
// answers with the problems, the solution per case under the operations manual and
// the action to apply. It only answers: it never reads or changes anything in the
// database. The panel runs an action only after the admin clicks and confirms.
// Rules and limits: src/lib/assistantPlan.ts.
//
// Needs ANTHROPIC_API_KEY in Vercel (console.anthropic.com > API keys). Without it
// the panel says the chat is not connected; nothing else changes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  PLAN_SCHEMA, sanitizeCases, sanitizePlan, sanitizeTurns, systemPrompt, userContent, MAX_TEXT,
} from '../src/lib/assistantPlan.js';

export const ASSISTANT_MODEL = 'claude-opus-5-5';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
export const anthropicKey = () => clean(process.env.ANTHROPIC_API_KEY);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// The manual travels with the function (vercel.json includeFiles). If it is ever
// missing, the chat still works with the core rules in the system prompt.
let manualCache: string | undefined;
const manual = () => {
  if (manualCache !== undefined) return manualCache;
  for (const base of [process.cwd(), join(process.cwd(), '..')]) {
    try { return (manualCache = readFileSync(join(base, 'docs/operations/manual-operacion.md'), 'utf8')); } catch { /* next */ }
  }
  return (manualCache = '(The manual could not be loaded. Use only the rules above and propose "open" when unsure.)');
};

const isAdmin = async (authorization: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, authorization, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401 || r.status === 403) return 'expired';
  if (!r.ok) throw Error('auth unavailable');
  return (await r.json()) === true ? 'admin' : 'denied';
};

export async function assistantResponse(request: Request, body: Record<string, unknown>, deps: {
  client?: Pick<Anthropic, 'beta'>; checkAdmin?: (auth: string) => Promise<string>;
} = {}): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return json(401, { error: 'Inicia sesión con tu cuenta de administrador.', code: 'auth' });
  try {
    const role = await (deps.checkAdmin ?? isAdmin)(authorization);
    if (role === 'expired') return json(401, { error: 'Tu sesión venció. Vuelve a iniciar sesión.', code: 'auth' });
    if (role !== 'admin') return json(403, { error: 'Solo el equipo administrador puede usar Mano derecha.', code: 'auth' });
  } catch {
    return json(503, { error: 'No pudimos comprobar tu sesión. Intenta de nuevo.', code: 'auth' });
  }

  const key = anthropicKey();
  if (!deps.client && !key) return json(503, { error: 'Falta conectar la llave de Claude (ANTHROPIC_API_KEY en Vercel).', code: 'setup' });

  const lang = body.lang === 'en' ? 'en' : 'es';
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_TEXT) : '';
  if (!question) return json(400, { error: lang === 'en' ? 'Write your question.' : 'Escribe tu pregunta.', code: 'input' });
  const cases = sanitizeCases(body.cases);
  const history = sanitizeTurns(body.history);
  const now = new Date().toISOString();

  const client = deps.client ?? new Anthropic({ apiKey: key, maxRetries: 1, timeout: 55_000 });
  try {
    const response = await client.beta.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
      // The manual is the same on every question: cached, it costs about a tenth.
      system: [{ type: 'text', text: systemPrompt(manual(), lang), cache_control: { type: 'ephemeral' } }],
      messages: [
        ...history.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user', content: userContent(question, cases, body.status, now) },
      ],
    });
    if (response.stop_reason === 'refusal') return json(200, { plan: { reply: lang === 'en' ? 'I can’t help with that one. Open the case in its screen.' : 'Con esa no te puedo ayudar. Abre el caso en su pantalla.', problems: [], solutions: [] } });
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return json(502, { error: 'La respuesta llegó incompleta. Pregunta de nuevo.', code: 'model' }); }
    return json(200, {
      plan: sanitizePlan(parsed, cases),
      usage: { input: response.usage.input_tokens, cached: response.usage.cache_read_input_tokens ?? 0, output: response.usage.output_tokens },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
      return json(503, { error: 'La llave de Claude no es válida. Revisa ANTHROPIC_API_KEY en Vercel.', code: 'setup' });
    if (err instanceof Anthropic.RateLimitError)
      return json(429, { error: 'Claude está ocupado o llegaste al límite de gasto. Intenta en un minuto.', code: 'limit' });
    if (err instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(err.message))
      return json(402, { error: 'Se acabó el saldo de Claude. Recarga créditos en console.anthropic.com.', code: 'credits' });
    if (err instanceof Anthropic.APIError)
      return json(502, { error: 'Claude no respondió bien. Intenta de nuevo en un momento.', code: 'model' });
    return json(502, { error: 'No pudimos hablar con Claude. Intenta de nuevo.', code: 'model' });
  }
}
