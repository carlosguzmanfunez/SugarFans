// Backend contract for creator recruitment ("Captar creadores"). Implemented by
// localProspects.ts and supabaseProspects.ts; rules and texts in src/lib/prospects.ts.
import type { MessageVariant, Prospect, ProspectChannel, ProspectEvent, ProspectInput, ProspectNetwork, ProspectSource, ProspectStatus, VariantStat } from '../prospects';
import type { AuthResult } from './types';

export interface ProspectSummary {
  byCountry: { country: string; status: ProspectStatus; count: number }[];
  contactedToday: number;
  followUpsDue: number;
  toEnrich: number; // Instagram accounts not checked with the official API yet
  last24h: Partial<Record<ProspectEvent, number>>;
  emailsToday: number;
  lastAutoSync?: string; // the daily automatic check (6:00 a. m. Honduras)
  measuredAt: string;
}

// What the server has set up: the official Instagram API and sending email from Zoho.
export interface ProspectServerStatus {
  instagram: 'ok' | 'missing' | 'unknown';
  email: 'ok' | 'missing' | 'unknown';
  emailLimit: number; // emails a day from the console
  emailFrom?: string;
}

// One email the admin wrote (already filled in for that creator).
export interface ProspectEmail { id: string; subject: string; body: string }
export type SendEmailsResult =
  | { ok: true; sent: string[]; skipped: { id: string; reason: string }[]; failed: { id: string; error: string }[]; remaining: number; warning?: string }
  | { ok: false; error: string };

// The public invite page (/c/<code>).
export interface InviteInfo {
  handle: string;
  network: ProspectNetwork;
  name?: string;
  country?: string;
  interested: boolean;
  registered: boolean;
  unsubscribed: boolean;
}

export interface ProspectFilter {
  country?: string; // ISO code; '' = without country; undefined = all
  status?: ProspectStatus | 'follow_up' | 'open' | 'joined'; // open = not discarded nor opted out; joined = registrado, verificado or activo
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
  variant?: MessageVariant; // the version of the first message they got
}

// For the "Metas" tab: how each message version answers, and creators invited by creators.
export interface ProspectInsights {
  variants: VariantStat[];
  creatorInvites: { total: number; verified: number; selling: number; last30Days: number };
  topInviters: { name: string; count: number }[];
  // Creadores Fundadores per country: seats taken (100 each), at risk of losing it, lost.
  founders: { country: string; active: number; atRisk: number; lost: number }[];
}

// Public numbers of a professional Instagram account from the official API.
export interface InstagramLookup {
  handle: string;
  ok: boolean;
  note?: string; // why it could not be read (personal account, doesn't exist…)
  data?: Pick<ProspectInput, 'display_name' | 'followers' | 'posts' | 'engagement' | 'last_post_at' | 'email' | 'bio' | 'website'>;
}

// "Conecta tu TikTok": the public numbers TikTok confirmed (api/tiktok.ts).
export interface TikTokConnection {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  followers?: number;
  likes?: number;
  videos?: number;
  connectedAt: string;
  refreshedAt: string;
}

export type ImportResult = { ok: true; inserted: number; updated: number; skipped: number } | { ok: false; error: string };

export interface ProspectsBackend {
  summary(): Promise<ProspectSummary>;
  list(filter: ProspectFilter, page: number, pageSize: number): Promise<{ rows: Prospect[]; total: number }>;
  // Everything that matches the filter, for the CSV export (at most 10,000).
  exportRows(filter: ProspectFilter): Promise<Prospect[]>;
  importRows(rows: ProspectInput[], source: ProspectSource): Promise<ImportResult>;
  update(id: string, patch: ProspectPatch): Promise<AuthResult>;
  // The same change for a whole batch (e.g. everyone in a downloaded email batch is now contacted).
  updateMany(ids: string[], patch: Pick<ProspectPatch, 'status' | 'channel' | 'variant'>): Promise<AuthResult>;
  insights(): Promise<ProspectInsights>;
  remove(id: string): Promise<AuthResult>;
  // Links prospects to the account that lists the same handle and moves them forward.
  sync(): Promise<{ ok: true; moved: number } | { ok: false; error: string }>;
  // Whether the official Instagram API and Zoho are set up on the server.
  serverStatus(): Promise<ProspectServerStatus>;
  // Sends up to 10 emails from Zoho; the server skips who opted out or has no email,
  // respects the daily limit and records what went out.
  sendEmails(emails: ProspectEmail[], followUp: boolean, base: string): Promise<SendEmailsResult>;
  // The public invite page. invite() also records that the link was opened.
  invite(code: string): Promise<InviteInfo | null>;
  interest(code: string, email?: string): Promise<AuthResult>;
  unsubscribe(code: string): Promise<AuthResult>;
  // Links the signed-in account to the invite (after sign-up or sign-in).
  claim(code: string): Promise<boolean>;
  // warning: Meta stopped answering part-way (limit reached, token expired); results has what it did answer.
  // "Conecta tu TikTok" for creators: whether the TikTok app is set up, the signed-in
  // user's connection, the TikTok address to go to (back = the page to return to),
  // and disconnecting it.
  tiktokAvailable(): Promise<boolean>;
  myTikTok(): Promise<TikTokConnection | null>;
  connectTikTok(back: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  disconnectTikTok(): Promise<AuthResult>;
  lookupInstagram(handles: string[]): Promise<{ ok: true; results: InstagramLookup[]; warning?: string } | { ok: false; error: string }>;
}
