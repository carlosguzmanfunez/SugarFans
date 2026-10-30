-- Fans Reserve: report/support submissions need server-side boundaries.
-- Public reports remain available to signed-out visitors.
-- No PayPal/payment paths, balances, permissions, or transactions are changed.
-- Contact-email throttling is defense in depth, not an IP/device rate limit.
CREATE OR REPLACE FUNCTION public.submit_report(
 p_kind text,p_target_id text,p_target_label text,p_reason text,p_description text,p_contact_email text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_me public.profiles;
 v_email text := lower(nullif(btrim(coalesce(p_contact_email,'')),''));
 v_description text := btrim(coalesce(p_description,''));
 v_label text := coalesce(nullif(btrim(p_target_label),''),'Sin especificar');
 v_reason text := btrim(coalesce(p_reason,''));
 v_rate_key text;
 v_count integer;
BEGIN
 SELECT * INTO v_me FROM public.profiles WHERE id = auth.uid();

 IF p_kind IS NULL OR p_kind NOT IN ('post','creator','other','support') THEN
   RAISE EXCEPTION 'Selecciona un tipo válido de reporte';
 END IF;
 IF char_length(v_description) NOT BETWEEN 10 AND 4000 THEN
   RAISE EXCEPTION 'Describe el problema entre 10 y 4000 caracteres';
 END IF;
 IF char_length(v_reason) NOT BETWEEN 1 AND 200 THEN
   RAISE EXCEPTION 'Selecciona un motivo válido (máximo 200 caracteres)';
 END IF;
 IF char_length(v_label) > 200 OR char_length(coalesce(p_target_id,'')) > 180 THEN
   RAISE EXCEPTION 'La referencia del reporte es demasiado larga';
 END IF;
 IF v_me.id IS NULL THEN
   IF v_email IS NULL OR char_length(v_email) > 254
       OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
     RAISE EXCEPTION 'Deja un email de contacto válido';
   END IF;
 END IF;

 -- Serialize concurrent submissions for the same account/contact key.
 v_rate_key := coalesce(v_me.id::text,v_email);
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('fansreserve-report:' || v_rate_key,0)
 );
 IF v_me.id IS NOT NULL THEN
   SELECT count(*) INTO v_count FROM public.reports
   WHERE reporter_id=v_me.id AND created_at>now()-interval '1 hour';
   IF v_count >= 10 THEN
     RAISE EXCEPTION 'Has enviado muchos reportes. Intenta de nuevo más tarde';
   END IF;
 ELSE
   SELECT count(*) INTO v_count FROM public.reports
   WHERE reporter_id IS NULL AND lower(contact_email)=v_email
     AND created_at>now()-interval '1 hour';
   IF v_count >= 5 THEN
     RAISE EXCEPTION 'Has enviado muchos reportes. Intenta de nuevo más tarde';
   END IF;
 END IF;

 INSERT INTO public.reports(kind,target_id,target_label,reason,description,reporter_id,reporter_name,contact_email)
 VALUES(p_kind,p_target_id,v_label,v_reason,v_description,
        v_me.id,coalesce(v_me.name,'Visitante'),coalesce(v_me.email,v_email));
END
$function$;
