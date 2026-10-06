-- Carlos (2026-10-06): Diamante no longer has its withdrawal fee paid by Fans
-- Reserve. Every creator pays PayPal's payout fee (2%, at most $20); Oro and
-- Diamante keep withdrawing from $25. Mirrors src/lib/rewardRules.ts.
-- Idempotent: safe to run again.

create or replace function public.payout_fee_for(p_user uuid, p_amount numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select public.payout_fee(p_amount);
$$;

create or replace function public.my_payout_terms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('min', public.payout_min(auth.uid()))
  from public.profiles p where p.id = auth.uid() and p.creator_profile_id is not null;
$$;
