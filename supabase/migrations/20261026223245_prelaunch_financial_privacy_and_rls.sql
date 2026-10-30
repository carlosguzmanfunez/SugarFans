-- Fans Reserve · Seguridad antes del lanzamiento
-- Versión aplicada y validada primero en el proyecto aislado de QA.
-- NO ALTERA cobros, comisiones, reembolsos ni payouts.
-- Una clasificación de fans obtiene nombres e importes de pagos; no es un dato público.
-- La lectura solo se permite a quien posee el perfil creador o al administrador.
CREATE OR REPLACE FUNCTION public.top_fans(p_creator_profile_id text)
RETURNS TABLE(name text, value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT max(t.payer_name), sum(t.amount)
 FROM public.transactions t
 WHERE t.creator_profile_id = p_creator_profile_id
   AND (public.owns_creator_profile(p_creator_profile_id) OR public.is_admin())
   AND t.kind = 'gift' AND t.status = 'paid'
   AND t.created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
 GROUP BY coalesce(t.payer_id::text,t.payer_name)
 ORDER BY 2 DESC LIMIT 5;
$$;

-- PostgreSQL PUBLIC grants override a simple REVOKE FROM anon.
REVOKE EXECUTE ON FUNCTION public.top_fans(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.top_fans(text) TO authenticated, service_role;

-- No change in security policy semantics. Reduces RLS auth.uid() calls per row.
ALTER POLICY "paypal_orders: own rows" ON public.paypal_orders
 USING (user_id = (SELECT auth.uid()));
ALTER POLICY "paypal_subscriptions: own rows" ON public.paypal_subscriptions
 USING (user_id = (SELECT auth.uid()));
