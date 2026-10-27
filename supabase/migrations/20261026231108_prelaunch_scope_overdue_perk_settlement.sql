-- Fans Reserve: scope overdue perk settlement to the caller's own accounts.
-- Previously every authenticated caller could refund ALL overdue perk
-- transactions platform-wide through SECURITY DEFINER.
-- Fans may settle perks they bought; creators may settle perks for their profile.
-- Preserve the same financial state transition for eligible rows; no external
-- PayPal refunds or payouts are invoked.
CREATE OR REPLACE FUNCTION public.settle_overdue_perks()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_creator text;
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  v_creator := public.my_creator_profile_id();

  SELECT array_agg(DISTINCT p.transaction_id) INTO v_ids
    FROM public.perk_requests p
   WHERE p.status = 'pending'
     AND p.due_at < now()
     AND (p.fan_id = v_actor
          OR (v_creator IS NOT NULL AND p.creator_profile_id = v_creator));

  IF v_ids IS NULL THEN RETURN; END IF;

  UPDATE public.transactions
     SET status = 'refunded'
   WHERE id = ANY(v_ids) AND status = 'paid';

  UPDATE public.perk_requests
     SET status = 'refunded'
   WHERE transaction_id = ANY(v_ids) AND status = 'pending';
END;
$function$;
