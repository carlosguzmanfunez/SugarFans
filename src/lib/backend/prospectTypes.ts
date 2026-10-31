// Backend contract for creator recruitment ("Captar creadores"). Implemented by
// localProspects.ts and supabaseProspects.ts; rules and texts in src/lib/prospects.ts.
import type { Prospect, ProspectChannel, ProspectInput, ProspectNetwork, ProspectSource, ProspectStatus } from '../prospects';
import type { AuthResult } from './types';

export interface ProspectSummary {
  byCountry: { country: string; status: ProspectStatus; count: number }[];
  contactedToday: number;
  followUpsDue: number;
  toEnrich: number; // Instagram accounts not checked with the official API yet
  measuredAt: string;
}

export interface ProspectFilter {
  country?: string; // ISO code; '' = without country; undefined = all
  status?: ProspectStatus | 'follow_up' | 'open'; // open = not discarded nor opted out
  network?: ProspectNetwork;
  minFollowers?: number;
  maxFollowers?: number;
  withEmail?: boolean;
  query?: string;
  sort?: 'score' | 'followers' | 'recent';
}

export interface ProspectPatch {
  status?: ProspectStatus;
  channel?: ProspectChannel | null;
  notes?: string;
  followUps?: number;
  country?: string | null;
  category?: string | null;
}

// Public numbers of a professional Instagram account from the official API.
export interface InstagramLookup {
  handle: string;
  ok: boolean;
  note?: string; // why it could not be read (personal account, doesn't exist…)
  data?: Pick<ProspectInput, 'display_name' | 'followers' | 'posts' | 'engagement' | 'last_post_at' | 'email' | 'bio' | 'website'>;
}

export type ImportResult = { ok: true; inserted: number; updated: number; skipped: number } | { ok: false; error: string };

export interface ProspectsBackend {
  summary(): Promise<ProspectSummary>;
  list(filter: ProspectFilter, page: number, pageSize: number): Promise<{ rows: Prospect[]; total: number }>;
  // Everything that matches the filter, for the CSV export (at most 10,000).
  exportRows(filter: ProspectFilter): Promise<Prospect[]>;
  importRows(rows: ProspectInput[], source: ProspectSource): Promise<ImportResult>;
  update(id: string, patch: ProspectPatch): Promise<AuthResult>;
  remove(id: string): Promise<AuthResult>;
  // Links prospects to the account that lists the same handle and moves them forward.
  sync(): Promise<{ ok: true; moved: number } | { ok: false; error: string }>;
  // Whether the official Instagram API is set up on the server.
  instagramStatus(): Promise<'ok' | 'missing' | 'unknown'>;
  // warning: Meta stopped answering part-way (limit reached, token expired); results has what it did answer.
  lookupInstagram(handles: string[]): Promise<{ ok: true; results: InstagramLookup[]; warning?: string } | { ok: false; error: string }>;
}
