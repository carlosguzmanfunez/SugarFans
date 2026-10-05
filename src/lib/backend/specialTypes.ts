// Types and backend contract for special accounts: links the admin creates to give a
// creator a special plan (Reserve al neto, extra visibility). Implemented by
// localSpecial.ts and supabaseSpecial.ts; rules in src/lib/specialRules.ts.
import type { AuthResult } from './types';

export interface SpecialTerms {
  label: string; // e.g. "Gimnasio de Juan"; only the admin and the creator see it
  reserveNet: boolean; // Reserve payments minus the gateway's fee and the tax
  taxRate: number; // 0..0.5 of each Reserve payment; 0 until the accountant says otherwise
  featured: boolean; // listed first among the featured creators
}

export interface SpecialInviteInput extends SpecialTerms {
  maxUses: number;
  expiresAt?: string;
}

export interface SpecialInvite extends SpecialInviteInput {
  code: string;
  uses: number;
  revokedAt?: string;
  createdAt: string;
}

export interface SpecialAccount extends SpecialTerms {
  creatorProfileId: string;
  userId: string;
  inviteCode?: string;
  since: string;
  revokedAt?: string; // the plan no longer applies to new payments
}

export type SpecialAccountPatch = Partial<Pick<SpecialAccount, 'reserveNet' | 'taxRate' | 'featured'>> & { active?: boolean };

export interface SpecialBackend {
  // Admin only.
  listInvites(): Promise<SpecialInvite[]>;
  createInvite(input: SpecialInviteInput): Promise<AuthResult & { code?: string }>;
  revokeInvite(code: string): Promise<AuthResult>;
  listAccounts(): Promise<SpecialAccount[]>;
  updateAccount(creatorProfileId: string, patch: SpecialAccountPatch): Promise<AuthResult>;
  // The signed-in creator's plan, if any (active or revoked).
  mine(): Promise<SpecialAccount | null>;
  // The signed-in creator activates a link.
  claim(code: string): Promise<AuthResult & { label?: string; already?: boolean }>;
}
