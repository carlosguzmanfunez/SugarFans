// Browser-only creator recruitment (dev and offline tests): same rules as the
// database, see supabase/migrations/20261101000001_creator_prospects.sql.
// The official Instagram API only answers on the published site.
import { readJSON, writeJSON } from '../storage';
import { FOLLOW_UP_DAYS, FUNNEL, prospectScore, type Prospect, type ProspectEvent, type ProspectStatus } from '../prospects';
import type { ProspectFilter, ProspectsBackend } from './prospectTypes';
import type { User } from './types';

interface Deps {
  currentUser(): User | null;
  accounts(): User[];
  hasRecentSale(creatorProfileId: string): boolean;
}

const KEY = 'creator_prospects';
const EVENTS_KEY = 'prospect_events';
const FAKE_ZOHO_KEY = 'prospectsFakeZoho';
const HANDLE = /^[a-z0-9._-]{1,50}$/;
const newCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
type Logged = { prospectId: string; kind: ProspectEvent; at: string };
const log = (prospectId: string, kind: ProspectEvent) =>
  writeJSON(EVENTS_KEY, [...readJSON<Logged[]>(EVENTS_KEY, []).filter((e) => Date.now() - new Date(e.at).getTime() < 7 * 86400000), { prospectId, kind, at: new Date().toISOString() }]);

const hondurasDay = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${parts}T00:00:00-06:00`).getTime();
};

const matches = (p: Prospect, f: ProspectFilter) => {
  if (f.country === '' ? !!p.country : f.country && p.country !== f.country) return false;
  if (f.status === 'open' && (p.status === 'descartado' || p.status === 'no_contactar')) return false;
  if (f.status === 'follow_up' && !(p.status === 'contactado' && p.followUps === 0 && p.contactedAt && Date.now() - new Date(p.contactedAt).getTime() > FOLLOW_UP_DAYS * 86400000)) return false;
  if (f.status && f.status !== 'open' && f.status !== 'follow_up' && p.status !== f.status) return false;
  if (f.network && p.network !== f.network) return false;
  if (f.minFollowers != null && !(p.followers != null && p.followers >= f.minFollowers)) return false;
  if (f.maxFollowers != null && !(p.followers != null && p.followers <= f.maxFollowers)) return false;
  if (f.withEmail && !p.email) return false;
  const q = f.query?.trim().replace(/^@/, '').toLowerCase();
  if (q && ![p.handle, p.displayName, p.email, p.category].some((v) => v?.toLowerCase().includes(q))) return false;
  return true;
};

const sorter = (sort: ProspectFilter['sort']) => (a: Prospect, b: Prospect) =>
  sort === 'followers' ? (b.followers ?? -1) - (a.followers ?? -1)
    : sort === 'recent' ? b.createdAt.localeCompare(a.createdAt)
      : b.score - a.score || (b.followers ?? -1) - (a.followers ?? -1);

export const createLocalProspects = (deps: Deps): ProspectsBackend => {
  // Lists saved before invite links existed get a code the first time they load.
  const load = () => {
    const list = readJSON<Prospect[]>(KEY, []);
    if (!list.some((p) => !p.inviteCode)) return list;
    const fixed = list.map((p) => (p.inviteCode ? p : { ...p, inviteCode: newCode(), openCount: 0 }));
    writeJSON(KEY, fixed);
    return fixed;
  };
  const byCode = (code: string) => load().find((p) => p.inviteCode === code.trim().toLowerCase());
  const save = (list: Prospect[]) => writeJSON(KEY, list);
  const isAdmin = () => deps.currentUser()?.role === 'admin';
  const denied = { ok: false as const, error: 'Solo un administrador puede hacer esto' };
  // The trigger in the database: dates, score and erasing contact data.
  const touch = (p: Prospect, before?: Prospect): Prospect => {
    const now = new Date().toISOString();
    const next = { ...p };
    if (next.status === 'no_contactar') { next.email = undefined; next.bio = undefined; next.notes = undefined; }
    if (!before || before.status !== next.status) {
      if (next.status === 'contactado' && !next.contactedAt) next.contactedAt = now;
      if (next.status === 'respondio' && !next.repliedAt) next.repliedAt = now;
    }
    if (before && next.followUps > before.followUps) { next.lastFollowUpAt = now; log(next.id, 'seguimiento'); }
    if (before && before.status !== next.status && (['contactado', 'registrado', 'verificado', 'activo'] as ProspectStatus[]).includes(next.status)) log(next.id, next.status as ProspectEvent);
    next.score = prospectScore(next);
    return next;
  };

  return {
    async summary() {
      if (!isAdmin()) throw Error('Solo un administrador puede ver esto');
      const list = load();
      const counts = new Map<string, number>();
      for (const p of list) counts.set(`${p.country ?? ''}|${p.status}`, (counts.get(`${p.country ?? ''}|${p.status}`) ?? 0) + 1);
      const today = hondurasDay();
      return {
        byCountry: [...counts].map(([k, count]) => { const [country, status] = k.split('|'); return { country, status: status as ProspectStatus, count }; }),
        contactedToday: list.filter((p) => p.contactedAt && new Date(p.contactedAt).getTime() >= today).length,
        followUpsDue: list.filter((p) => matches(p, { status: 'follow_up' })).length,
        toEnrich: list.filter((p) => p.network === 'instagram' && !p.enrichedAt && matches(p, { status: 'open' })).length,
        last24h: readJSON<Logged[]>(EVENTS_KEY, []).filter((e) => Date.now() - new Date(e.at).getTime() < 86400000)
          .reduce<Partial<Record<ProspectEvent, number>>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {}),
        emailsToday: readJSON<Logged[]>(EVENTS_KEY, []).filter((e) => e.kind === 'correo' && new Date(e.at).getTime() >= today).length,
        measuredAt: new Date().toISOString(),
      };
    },

    async list(filter, page, pageSize) {
      if (!isAdmin()) throw Error('Solo un administrador puede ver esto');
      const all = load().filter((p) => matches(p, filter)).sort(sorter(filter.sort));
      return { rows: all.slice(page * pageSize, page * pageSize + pageSize), total: all.length };
    },

    async exportRows(filter) {
      return load().filter((p) => matches(p, filter)).sort(sorter(filter.sort)).slice(0, 10000);
    },

    async importRows(rows, source) {
      if (!isAdmin()) return denied;
      const list = load();
      const index = new Map(list.map((p, i) => [`${p.network}:${p.handle}`, i]));
      let inserted = 0, updated = 0, skipped = 0;
      for (const r of rows) {
        const handle = r.handle?.replace(/^@/, '').toLowerCase();
        if (!handle || !HANDLE.test(handle) || !['instagram', 'tiktok', 'facebook', 'youtube'].includes(r.network)) { skipped++; continue; }
        const fresh = {
          country: r.country, city: r.city, displayName: r.display_name, category: r.category, followers: r.followers, posts: r.posts,
          engagement: r.engagement, lastPostAt: r.last_post_at, email: r.email?.toLowerCase(), bio: r.bio, website: r.website,
          ...(r.enriched ? { enrichedAt: new Date().toISOString(), enrichNote: r.enrich_note || undefined } : {}),
        };
        const at = index.get(`${r.network}:${handle}`);
        if (at === undefined) {
          const p: Prospect = { id: crypto.randomUUID(), network: r.network, handle, source, status: 'nuevo', followUps: 0, score: 0, inviteCode: newCode(), openCount: 0, createdAt: new Date().toISOString(), ...fresh };
          index.set(`${r.network}:${handle}`, list.length);
          list.push(touch(p));
          inserted++;
        } else {
          const before = list[at];
          const merged = { ...before };
          for (const [k, v] of Object.entries(fresh)) if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
          if (r.enriched) merged.enrichNote = r.enrich_note || undefined;
          list[at] = touch(merged, before);
          updated++;
        }
      }
      save(list);
      return { ok: true, inserted, updated, skipped };
    },

    async update(id, patch) {
      if (!isAdmin()) return denied;
      const list = load();
      const at = list.findIndex((p) => p.id === id);
      if (at < 0) return { ok: false, error: 'Ya no está en la lista.' };
      const before = list[at];
      const next: Prospect = { ...before };
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.channel !== undefined) next.channel = patch.channel ?? undefined;
      if (patch.notes !== undefined) next.notes = patch.notes.trim().slice(0, 1000) || undefined;
      if (patch.followUps !== undefined) next.followUps = patch.followUps;
      if (patch.country !== undefined) next.country = patch.country ?? undefined;
      if (patch.category !== undefined) next.category = patch.category?.trim() || undefined;
      list[at] = touch(next, before);
      save(list);
      return { ok: true };
    },

    async updateMany(ids, patch) {
      if (!isAdmin()) return denied;
      const wanted = new Set(ids);
      save(load().map((p) => (wanted.has(p.id) ? touch({ ...p, ...(patch.status ? { status: patch.status } : {}), ...(patch.channel !== undefined ? { channel: patch.channel ?? undefined } : {}) }, p) : p)));
      return { ok: true };
    },

    async remove(id) {
      if (!isAdmin()) return denied;
      save(load().filter((p) => p.id !== id));
      return { ok: true };
    },

    async sync() {
      if (!isAdmin()) return denied;
      const accounts = deps.accounts().filter((a) => a.role !== 'admin');
      let moved = 0;
      const list = load().map((p) => {
        const found = accounts.find((a) => a.id === p.matchedProfileId) ?? accounts.find((a) => a.settings.socials?.[p.network]?.toLowerCase() === p.handle);
        if (!found) return p;
        const target: ProspectStatus = found.role === 'creator' && found.isVerified
          ? (found.creatorProfileId && deps.hasRecentSale(found.creatorProfileId) ? 'activo' : 'verificado') : 'registrado';
        const forward = FUNNEL.indexOf(target) > FUNNEL.indexOf(p.status);
        if (!forward && p.matchedProfileId === found.id) return p;
        moved++;
        return touch({ ...p, matchedProfileId: found.id, status: forward ? target : p.status }, p);
      });
      save(list);
      return { ok: true, moved };
    },

    // Offline there is no server: the e2e suite turns on a stand-in Zoho with this flag.
    async serverStatus() {
      const fake = readJSON(FAKE_ZOHO_KEY, false);
      return { instagram: 'missing' as const, email: fake ? 'ok' as const : 'missing' as const, emailLimit: fake ? 30 : 0, emailFrom: fake ? 'carlos@fansreserve.com' : undefined };
    },

    async sendEmails(emails, followUp) {
      if (!isAdmin()) return denied;
      if (!readJSON(FAKE_ZOHO_KEY, false)) return { ok: false as const, error: 'Los correos desde Zoho solo salen en la página publicada.' };
      const list = load();
      const sentToday = readJSON<Logged[]>(EVENTS_KEY, []).filter((e) => e.kind === 'correo' && new Date(e.at).getTime() >= hondurasDay()).length;
      let remaining = Math.max(0, 30 - sentToday);
      const sent: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const m of emails.slice(0, 5)) {
        const p = list.find((x) => x.id === m.id);
        const reason = !p ? 'Ya no está en la lista' : p.status === 'no_contactar' ? 'Pidió que no le escribamos' : p.status === 'descartado' ? 'Está descartado'
          : !p.email ? 'No tiene correo' : followUp ? (p.status !== 'contactado' ? 'No está esperando seguimiento' : '') : p.status !== 'nuevo' ? 'Ya estaba contactado' : !remaining ? 'Se llegó al límite de hoy' : '';
        if (reason) { skipped.push({ id: m.id, reason }); continue; }
        sent.push(m.id);
        remaining--;
      }
      save(list.map((p) => (sent.includes(p.id) ? touch(followUp ? { ...p, followUps: Math.min(5, p.followUps + 1) } : { ...p, status: 'contactado', channel: 'email' }, p) : p)));
      sent.forEach((id) => log(id, 'correo'));
      return { ok: true as const, sent, skipped, failed: [], remaining };
    },

    async invite(code) {
      const p = byCode(code);
      if (!p) return null;
      if (p.status === 'no_contactar') return { handle: p.handle, network: p.network, interested: false, registered: false, unsubscribed: true };
      if (!isAdmin()) {
        const now = new Date().toISOString();
        save(load().map((x) => (x.id === p.id ? { ...x, openedAt: x.openedAt ?? now, openCount: (x.openCount ?? 0) + 1 } : x)));
        if (!p.openedAt) log(p.id, 'abrio');
      }
      return {
        handle: p.handle, network: p.network, name: p.displayName, country: p.country,
        interested: !!p.interestedAt, registered: FUNNEL.indexOf(p.status) >= 3, unsubscribed: false,
      };
    },

    async interest(code, email) {
      const clean = email?.trim().toLowerCase() || undefined;
      if (clean && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Ese correo no parece válido' };
      const p = byCode(code);
      if (!p || p.status === 'no_contactar') return { ok: false, error: 'Esta invitación ya no está activa.' };
      if (isAdmin()) return { ok: true };
      save(load().map((x) => (x.id === p.id ? touch({
        ...x, interestedAt: x.interestedAt ?? new Date().toISOString(), email: x.email ?? clean,
        status: x.status === 'nuevo' || x.status === 'contactado' ? 'respondio' : x.status,
      }, x) : x)));
      if (!p.interestedAt) log(p.id, 'interesado');
      return { ok: true };
    },

    async unsubscribe(code) {
      const p = byCode(code);
      if (!p) return { ok: false, error: 'Esta invitación ya no está activa.' };
      if (p.status !== 'no_contactar') {
        save(load().map((x) => (x.id === p.id ? touch({ ...x, status: 'no_contactar' }, x) : x)));
        log(p.id, 'baja');
      }
      return { ok: true };
    },

    async claim(code) {
      const me = deps.currentUser();
      const p = byCode(code);
      if (!me || me.role === 'admin' || !p || (p.matchedProfileId && p.matchedProfileId !== me.id)) return false;
      save(load().map((x) => (x.id === p.id ? touch({ ...x, matchedProfileId: me.id, status: FUNNEL.indexOf(x.status) < 3 ? 'registrado' : x.status }, x) : x)));
      return true;
    },

    async lookupInstagram() {
      return { ok: false, error: 'La revisión con Instagram solo funciona en la página publicada.' };
    },
  };
};
