-- Fans Reserve · purchasing Credits and gifting them are separate events.
-- A legacy gift benefit overdue date is NOT a refund. Do not manufacture a
-- PayPal refund, change settled gift revenue, remove a creator's earnings,
-- or put spent Credits back in a fan wallet.
-- Keep promised legacy benefits pending for supervised review; these require
-- a separate resolution procedure according to original terms and applicable law.
--
-- Signature retained for compatibility: existing wallet and perk delivery
-- clients still call this RPC. This no-op is intentional and auditable.
CREATE OR REPLACE FUNCTION public.settle_overdue_perks()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;
  -- Never change public.transactions or public.perk_requests on expiry.
  RETURN;
END;
$function$;
