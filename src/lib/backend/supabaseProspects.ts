// Supabase implementation of creator recruitment. The admin reads and changes
// public.creator_prospects through row security; new rows only come in through
// prospects_import(). The official Instagram API is called from api/prospects.ts.
// See supabase/migrations/20261101000001_creator_prospects.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { FOLLOW_UP_DAYS, type Prospect } from '../prospects';
import type { ProspectFilter, ProspectsBackend } from './prospectTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown) => (v == null ? undefined : Number(v));
const toProspect = (r: Row): Prospect => ({
  id: r.id, network: r.network, handle: r.handle, country: r.country ?? undefined, city: r.city ?? undefined,
  displayName: r.display_name ?? undefined, category: r.category ?? undefined, followers: num(r.followers), posts: num(r.posts),
  engagement: num(r.engagement), lastPostAt: r.last_post_at ?? undefined, email: r.email ?? undefined, bio: r.bio ?? undefined,
  website: r.website ?? undefined, source: r.source, status: r.status, channel: r.channel ?? undefined,
  contactedAt: r.contacted_at ?? undefined, repliedAt: r.replied_at ?? undefined, followUps: r.follow_ups ?? 0,
  lastFollowUpAt: r.last_follow_up_at ?? undefined, notes: r.notes ?? undefined, score: r.score ?? 0,
  enrichedAt: r.enriched_at ?? undefined, enrichNote: r.enrich_note ?? undefined, matchedProfileId: r.matched_profile_id ?? undefined,
  createdAt: r.created_at,
});

const ours = (msg = '') => /[áéíóúñ¿]|Solo|Importa|Origen|La lista/.test(msg);

export const createSupabaseProspects = (sb: SupabaseClient): ProspectsBackend => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = (f: ProspectFilter, count = false): any => {
    let q = sb.from('creator_prospects').select('*', count ? { count: 'exact' } : undefined);
    if (f.country === '') q = q.is('country', null);
    else if (f.country) q = q.eq('country', f.country);
    if (f.status === 'open') q = q.not('status', 'in', '(descartado,no_contactar)');
    else if (f.status === 'follow_up') q = q.eq('status', 'contactado').eq('follow_ups', 0).lt('contacted_at', new Date(Date.now() - FOLLOW_UP_DAYS * 86400000).toISOString());
    else if (f.status) q = q.eq('status', f.status);
    if (f.network) q = q.eq('network', f.network);
    if (f.minFollowers != null) q = q.gte('followers', f.minFollowers);
    if (f.maxFollowers != null) q = q.lte('followers', f.maxFollowers);
    if (f.withEmail) q = q.not('email', 'is', null);
    const text = f.query?.trim().replace(/[,()%*\\]/g, ' ').replace(/^@/, '').trim();
    if (text) q = q.or(`handle.ilike.%${text}%,display_name.ilike.%${text}%,email.ilike.%${text}%,category.ilike.%${text}%`);
    if (f.sort === 'followers') q = q.order('followers', { ascending: false, nullsFirst: false });
    else if (f.sort === 'recent') q = q.order('created_at', { ascending: false });
    else q = q.order('score', { ascending: false }).order('followers', { ascending: false, nullsFirst: false });
    return q.order('id');
  };

  const session = async () => (await sb.auth.getSession()).data.session?.access_token;

  return {
    async summary() {
      const { data, error } = await sb.rpc('prospects_summary');
      if (error || !data) throw Error('No pudimos consultar la captación de creadores.');
      const d = data as Row;
      return {
        byCountry: ((d.by_country ?? []) as Row[]).map((r) => ({ country: r.country ?? '', status: r.status, count: Number(r.count) })),
        contactedToday: Number(d.contacted_today ?? 0), followUpsDue: Number(d.follow_ups_due ?? 0),
        toEnrich: Number(d.to_enrich ?? 0), measuredAt: d.measured_at,
      };
    },

    async list(filter, page, pageSize) {
      const { data, error, count } = await filtered(filter, true).range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw Error('No pudimos consultar la lista de creadores.');
      return { rows: ((data ?? []) as Row[]).map(toProspect), total: count ?? 0 };
    },

    async exportRows(filter) {
      const out: Prospect[] = [];
      for (let from = 0; from < 10000; from += 1000) {
        const { data, error } = await filtered(filter).range(from, from + 999);
        if (error) throw Error('No pudimos preparar el archivo.');
        out.push(...((data ?? []) as Row[]).map(toProspect));
        if (!data || data.length < 1000) break;
      }
      return out;
    },

    async importRows(rows, source) {
      let inserted = 0, updated = 0, skipped = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const { data, error } = await sb.rpc('prospects_import', { p_rows: rows.slice(i, i + 1000), p_source: source });
        if (error) return { ok: false, error: ours(error.message) ? error.message : 'No se pudo importar la lista.' };
        inserted += data.inserted; updated += data.updated; skipped += data.skipped;
      }
      return { ok: true, inserted, updated, skipped };
    },

    async update(id, patch) {
      const row: Row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.channel !== undefined) row.channel = patch.channel;
      if (patch.notes !== undefined) row.notes = patch.notes.trim().slice(0, 1000) || null;
      if (patch.followUps !== undefined) row.follow_ups = patch.followUps;
      if (patch.country !== undefined) row.country = patch.country;
      if (patch.category !== undefined) row.category = patch.category?.trim().slice(0, 60) || null;
      const { error } = await sb.from('creator_prospects').update(row).eq('id', id);
      return error ? { ok: false, error: 'No se pudo guardar el cambio.' } : { ok: true };
    },

    async updateMany(ids, patch) {
      const row: Row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.channel !== undefined) row.channel = patch.channel;
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from('creator_prospects').update(row).in('id', ids.slice(i, i + 200));
        if (error) return { ok: false, error: 'No se pudo guardar el cambio en todo el lote.' };
      }
      return { ok: true };
    },

    async remove(id) {
      const { error } = await sb.from('creator_prospects').delete().eq('id', id);
      return error ? { ok: false, error: 'No se pudo borrar.' } : { ok: true };
    },

    async sync() {
      const { data, error } = await sb.rpc('prospects_sync');
      return error ? { ok: false, error: 'No pudimos buscar quiénes ya se registraron.' } : { ok: true, moved: Number(data ?? 0) };
    },

    async instagramStatus() {
      try {
        const r = await fetch('/api/prospects', { cache: 'no-store' });
        const body = await r.json();
        return body?.checks?.instagram === 'OK' ? 'ok' : 'missing';
      } catch {
        return 'unknown';
      }
    },

    async lookupInstagram(handles) {
      const token = await session();
      if (!token) return { ok: false, error: 'Inicia sesión con tu cuenta administrativa.' };
      try {
        const r = await fetch('/api/prospects', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ handles }),
        });
        const body = await r.json().catch(() => ({}));
        const error = typeof body.error === 'string' ? body.error : undefined;
        if (!r.ok) return { ok: false, error: error ?? 'Instagram no respondió. Intenta de nuevo en unos minutos.' };
        return { ok: true, results: body.results ?? [], warning: error };
      } catch {
        return { ok: false, error: 'Sin conexión con el servidor.' };
      }
    },
  };
};
